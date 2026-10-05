import type { Request, Response } from "express";
import { z } from "zod";
import { env } from "../../env.js";
import { db } from "../../db.js";
import { ApiError } from "../../middlewares/error.middleware.js";
import { auth, tenantScope } from "../../middlewares/auth.middleware.js";
import { auditContext, recordAudit } from "../../lib/audit.js";

export const vehicleSchema = z.object({
  customerId: z.string().uuid().optional(),
  vin: z.string().trim().length(17, "A VIN is 17 characters.").optional().or(z.literal("")),
  plate: z.string().optional().nullable(),
  plateState: z.string().optional().nullable(),
  year: z.number().int().min(1900).max(2100).optional().nullable(),
  make: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  trim: z.string().optional().nullable(),
  engine: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
});

export async function listVehicles(req: Request, res: Response) {
  const q = String(req.query.q ?? "").trim();
  const customerId = req.query.customerId ? String(req.query.customerId) : undefined;

  const vehicles = await db.vehicle.findMany({
    where: {
      ...tenantScope(req),
      ...(customerId ? { owners: { some: { customerId } } } : {}),
      ...(q
        ? {
            OR: [
              { vin: { contains: q } },
              { plate: { contains: q } },
              { make: { contains: q } },
              { model: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      owners: { include: { customer: true } },
      mileageReadings: { orderBy: { observedAt: "desc" }, take: 1 },
    },
  });

  res.json({ data: vehicles });
}

export async function getVehicle(req: Request, res: Response) {
  const vehicle = await db.vehicle.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: {
      owners: { include: { customer: true } },
      mileageReadings: { orderBy: { observedAt: "desc" }, take: 20 },
      repairOrders: {
        orderBy: { createdAt: "desc" },
        include: { invoices: { select: { number: true, total: true, status: true } } },
      },
      inspections: { orderBy: { createdAt: "desc" }, take: 10, include: { items: true } },
    },
  });
  if (!vehicle) throw ApiError.notFound("Vehicle not found.");
  res.json(vehicle);
}

export async function createVehicle(req: Request, res: Response) {
  const ctx = auth(req);
  const body = vehicleSchema.parse(req.body);
  const vin = body.vin ? body.vin.toUpperCase() : null;

  if (vin) {
    const duplicate = await db.vehicle.findFirst({
      where: { ...tenantScope(req), vin },
    });
    if (duplicate) throw ApiError.conflict("That VIN is already on file for this shop.");
  }

  const vehicle = await db.vehicle.create({
    data: {
      organizationId: ctx.organizationId,
      vin,
      plate: body.plate,
      plateState: body.plateState,
      year: body.year,
      make: body.make,
      model: body.model,
      trim: body.trim,
      engine: body.engine,
      color: body.color,
      ...(body.customerId
        ? { owners: { create: { customerId: body.customerId } } }
        : {}),
    },
    include: { owners: true },
  });

  await recordAudit(db, {
    organizationId: ctx.organizationId,
    ...auditContext(req),
    action: "vehicle.created",
    resourceType: "vehicle",
    resourceId: vehicle.id,
  });
  res.status(201).json(vehicle);
}

export async function updateVehicle(req: Request, res: Response) {
  const ctx = auth(req);
  const body = vehicleSchema.partial().parse(req.body);

  const existing = await db.vehicle.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!existing) throw ApiError.notFound("Vehicle not found.");

  const correctsDecoded =
    existing.vinSource &&
    (body.year !== undefined || body.make !== undefined || body.model !== undefined);

  const vehicle = await db.vehicle.update({
    where: { id: existing.id },
    data: {
      ...body,
      vin: body.vin ? body.vin.toUpperCase() : body.vin === "" ? null : undefined,
      ...(correctsDecoded ? { vinCorrectedBy: ctx.userId } : {}),
    },
  });

  await recordAudit(db, {
    organizationId: ctx.organizationId,
    ...auditContext(req),
    action: correctsDecoded ? "vehicle.decoded_data_corrected" : "vehicle.updated",
    resourceType: "vehicle",
    resourceId: vehicle.id,
    metadata: { changed: Object.keys(body) },
  });
  res.json(vehicle);
}

export async function addMileage(req: Request, res: Response) {
  const { miles } = z.object({ miles: z.number().int().min(0) }).parse(req.body);
  const vehicle = await db.vehicle.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: { mileageReadings: { orderBy: { observedAt: "desc" }, take: 1 } },
  });
  if (!vehicle) throw ApiError.notFound("Vehicle not found.");

  const last = vehicle.mileageReadings[0];
  if (last && miles < last.miles) {
    throw ApiError.unprocessable(
      `Recorded mileage (${miles}) is below the last reading (${last.miles}). Correct the reading or note the reason.`,
    );
  }

  const reading = await db.mileageReading.create({
    data: { vehicleId: vehicle.id, miles },
  });
  res.status(201).json(reading);
}

export async function addOwner(req: Request, res: Response) {
  const { customerId } = z.object({ customerId: z.string().uuid() }).parse(req.body);

  const [vehicle, customer] = await Promise.all([
    db.vehicle.findFirst({ where: { id: req.params.id, ...tenantScope(req) } }),
    db.customer.findFirst({ where: { id: customerId, ...tenantScope(req) } }),
  ]);
  if (!vehicle) throw ApiError.notFound("Vehicle not found.");
  if (!customer) throw ApiError.notFound("Customer not found.");

  const link = await db.customerVehicle.upsert({
    where: { customerId_vehicleId: { customerId, vehicleId: vehicle.id } },
    create: { customerId, vehicleId: vehicle.id },
    update: {},
  });
  res.status(201).json(link);
}

export async function decodeVin(req: Request, res: Response) {
  const { vin } = z
    .object({ vin: z.string().trim().length(17, "A VIN is 17 characters.") })
    .parse(req.body);

  if (!env.vinDecodeEnabled) {
    res.json({
      vin: vin.toUpperCase(),
      source: null,
      decoded: null,
      warnings: ["VIN decoding is turned off in this environment. Enter the vehicle manually."],
    });
    return;
  }

  const url = `${env.nhtsaBaseUrl}/vehicles/DecodeVinValuesExtended/${encodeURIComponent(vin)}?format=json`;
  const warnings: string[] = [];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) throw new Error(`vPIC responded ${response.status}`);
    const json = (await response.json()) as { Results?: Array<Record<string, string>> };
    const row = json.Results?.[0];
    if (!row) throw new Error("vPIC returned no rows");

    const decoded = {
      year: row.ModelYear ? Number(row.ModelYear) : null,
      make: row.Make || null,
      model: row.Model || null,
      trim: row.Trim || row.Series || null,
      engine:
        [row.EngineCylinders && `${row.EngineCylinders}cyl`, row.DisplacementL && `${row.DisplacementL}L`, row.FuelTypePrimary]
          .filter(Boolean)
          .join(" ") || null,
      bodyClass: row.BodyClass || null,
    };

    if (row.ErrorText && !row.ErrorText.startsWith("0 -")) warnings.push(row.ErrorText);
    for (const [key, value] of Object.entries(decoded)) {
      if (!value) warnings.push(`vPIC did not return ${key}. Enter it manually if needed.`);
    }

    res.json({
      vin: vin.toUpperCase(),
      source: "nhtsa_vpic",
      retrievedAt: new Date().toISOString(),
      decoded,
      warnings,
      disclaimer:
        "VIN decoding identifies the vehicle as built. It is not accident history and does not guarantee parts fitment.",
    });
  } catch (error) {
    res.json({
      vin: vin.toUpperCase(),
      source: null,
      decoded: null,
      warnings: [
        "The vehicle data service is unavailable right now. Enter the vehicle details manually.",
        error instanceof Error ? error.message : String(error),
      ],
    });
  }
}

export async function applyDecode(req: Request, res: Response) {
  const ctx = auth(req);
  const body = z
    .object({
      source: z.string(),
      decoded: z.record(z.unknown()),
      raw: z.record(z.unknown()).optional(),
    })
    .parse(req.body);

  const existing = await db.vehicle.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!existing) throw ApiError.notFound("Vehicle not found.");

  const d = body.decoded as Record<string, string | number | null>;
  const vehicle = await db.vehicle.update({
    where: { id: existing.id },
    data: {
      year: typeof d.year === "number" ? d.year : existing.year,
      make: (d.make as string) ?? existing.make,
      model: (d.model as string) ?? existing.model,
      trim: (d.trim as string) ?? existing.trim,
      engine: (d.engine as string) ?? existing.engine,
      vinSource: body.source,
      vinDecodedAt: new Date(),
      vinRaw: (body.raw ?? body.decoded) as object,
    },
  });

  await recordAudit(db, {
    organizationId: ctx.organizationId,
    ...auditContext(req),
    action: "vehicle.decode_applied",
    resourceType: "vehicle",
    resourceId: vehicle.id,
    metadata: { source: body.source },
  });
  res.json(vehicle);
}

type CachedMakes = { fetchedAt: number; makes: string[] };
let makesCache: CachedMakes | null = null;
const MAKES_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function loadAllMakes(): Promise<string[]> {
  if (makesCache && Date.now() - makesCache.fetchedAt < MAKES_CACHE_TTL_MS) {
    return makesCache.makes;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${env.nhtsaBaseUrl}/vehicles/GetMakesForVehicleType/car?format=json`, {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`vPIC responded ${response.status}`);
    const json = (await response.json()) as { Results?: Array<{ MakeName?: string }> };
    const makes = [
      ...new Set(
        (json.Results ?? [])
          .map((r) => r.MakeName?.trim())
          .filter((m): m is string => Boolean(m)),
      ),
    ].sort((a, b) => a.localeCompare(b));

    makesCache = { fetchedAt: Date.now(), makes };
    return makes;
  } finally {
    clearTimeout(timer);
  }
}

export async function getReferenceMakes(req: Request, res: Response) {
  const q = String(req.query.q ?? "").trim().toLowerCase();
  try {
    const all = await loadAllMakes();
    const matches = q ? all.filter((m) => m.toLowerCase().includes(q)) : all;
    res.json({ data: matches.slice(0, 50), source: "nhtsa_vpic" });
  } catch {
    res.json({
      data: [],
      source: null,
      warning: "The vehicle reference service is unavailable right now. Type the make manually.",
    });
  }
}

export async function getReferenceModels(req: Request, res: Response) {
  const make = String(req.query.make ?? "").trim();
  const year = String(req.query.year ?? "").trim();
  if (!make) throw ApiError.badRequest("A make is required.");

  const url = year
    ? `${env.nhtsaBaseUrl}/vehicles/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${encodeURIComponent(year)}?format=json`
    : `${env.nhtsaBaseUrl}/vehicles/GetModelsForMake/${encodeURIComponent(make)}?format=json`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`vPIC responded ${response.status}`);

    const json = (await response.json()) as { Results?: Array<{ Model_Name?: string }> };
    const models = [
      ...new Set(
        (json.Results ?? [])
          .map((r) => r.Model_Name?.trim())
          .filter((m): m is string => Boolean(m)),
      ),
    ].sort((a, b) => a.localeCompare(b));

    res.json({ data: models, source: "nhtsa_vpic" });
  } catch {
    res.json({
      data: [],
      source: null,
      warning: "The vehicle reference service is unavailable right now. Type the model manually.",
    });
  }
}
