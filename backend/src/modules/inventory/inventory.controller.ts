import { type Request, type Response } from "express";
import { z } from "zod";
import type { InventoryProduct } from "@prisma/client";
import { db } from "../../db.js";
import { ApiError } from "../../middlewares/error.middleware.js";
import { queryEnum } from "../../utils/query.js";
import { auth, tenantScope } from "../../middlewares/auth.middleware.js";
import { can } from "../../middlewares/rbac.middleware.js";
import { auditContext, recordAudit } from "../../lib/audit.js";
import {
  flagLowStock,
  inStockCounts,
  isLowStock,
  normalizeSerial,
  parseSerials,
} from "../../domain/inventory.js";

const KINDS = ["TIRE", "MUFFLER", "OTHER"] as const;

function present(
  product: InventoryProduct,
  inStock: number,
  showCost: boolean,
  extra: Record<string, unknown> = {},
) {
  return {
    ...product,
    costCents: showCost ? product.costCents : null,
    inStock,
    lowStock: isLowStock(inStock, product.reorderPoint),
    ...extra,
  };
}

export const listProducts = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const kind = queryEnum(req.query.kind, KINDS, "kind");
  const q = String(req.query.q ?? "").trim().slice(0, 80);
  const lowOnly = req.query.low === "true";
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "25"), 10) || 25));
  const skip = (page - 1) * limit;
  const sortOrder = req.query.sortOrder === "asc" ? "asc" : "desc";
  const sortBy = req.query.sortBy === "name" ? "name" : "createdAt";

  const where = {
    ...tenantScope(req),
    isActive: true,
    ...(kind ? { kind } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q } },
            { brand: { contains: q } },
            { size: { contains: q } },
            { sku: { contains: q } },
            { units: { some: { serialNumber: { contains: normalizeSerial(q) } } } },
          ],
        }
      : {}),
  };

  const showCost = can(ctx.role, "reports.costs");
  const orderBy =
    sortBy === "name"
      ? [{ kind: "asc" as const }, { brand: sortOrder as "asc" | "desc" }, { name: sortOrder as "asc" | "desc" }]
      : [{ createdAt: sortOrder as "asc" | "desc" }];

  if (lowOnly) {
    const products = await db.inventoryProduct.findMany({
      where,
      orderBy,
    });
    const counts = await inStockCounts(db, ctx.organizationId, products.map((p) => p.id));
    const allLow = products
      .map((p) => present(p, counts.get(p.id) ?? 0, showCost))
      .filter((p) => p.lowStock);
    const total = allLow.length;
    const paginated = allLow.slice(skip, skip + limit);

    return res.json({
      data: paginated,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  }

  const [total, products] = await Promise.all([
    db.inventoryProduct.count({ where }),
    db.inventoryProduct.findMany({
      where,
      orderBy,
      skip,
      take: limit,
    }),
  ]);

  const counts = await inStockCounts(db, ctx.organizationId, products.map((p) => p.id));
  const data = products.map((p) => present(p, counts.get(p.id) ?? 0, showCost));

  res.json({
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  });
};

export const getLowStock = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const products = await db.inventoryProduct.findMany({
    where: { ...tenantScope(req), isActive: true },
  });
  const counts = await inStockCounts(db, ctx.organizationId);
  const low = products
    .map((p) => ({
      id: p.id,
      kind: p.kind,
      brand: p.brand,
      name: p.name,
      size: p.size,
      inStock: counts.get(p.id) ?? 0,
      reorderPoint: p.reorderPoint,
    }))
    .filter((p) => isLowStock(p.inStock, p.reorderPoint))
    .sort((a, b) => a.inStock - a.reorderPoint - (b.inStock - b.reorderPoint));
  res.json({ data: low, count: low.length });
};

export const lookupUnit = async (req: Request, res: Response) => {
  const serial = normalizeSerial(String(req.query.serial ?? ""));
  if (!serial) throw ApiError.badRequest("Enter a serial number.");
  const unit = await db.inventoryUnit.findFirst({
    where: { ...tenantScope(req), serialNumber: serial },
    include: {
      product: true,
      invoice: { select: { id: true, number: true } },
    },
  });
  if (!unit) throw ApiError.notFound(`No item with serial ${serial} in this shop.`);
  const showCost = can(auth(req).role, "reports.costs");
  res.json({
    ...unit,
    costCents: showCost ? unit.costCents : null,
    product: { ...unit.product, costCents: showCost ? unit.product.costCents : null },
  });
};

export const getAvailable = async (req: Request, res: Response) => {
  const kind = queryEnum(req.query.kind, KINDS, "kind");
  const q = String(req.query.q ?? "").trim().slice(0, 80);
  const products = await db.inventoryProduct.findMany({
    where: {
      ...tenantScope(req),
      isActive: true,
      ...(kind ? { kind } : {}),
      units: { some: { status: "IN_STOCK" } },
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { brand: { contains: q } },
              { size: { contains: q } },
              { units: { some: { serialNumber: { contains: normalizeSerial(q) }, status: "IN_STOCK" } } },
            ],
          }
        : {}),
    },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    take: 50,
    include: {
      units: {
        where: { status: "IN_STOCK" },
        orderBy: { receivedAt: "asc" },
        select: { id: true, serialNumber: true, receivedAt: true },
      },
    },
  });
  const showCost = can(auth(req).role, "reports.costs");
  res.json({
    data: products.map((p) => ({ ...p, costCents: showCost ? p.costCents : null })),
  });
};

export const getProductById = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const product = await db.inventoryProduct.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: {
      units: {
        orderBy: [{ status: "asc" }, { receivedAt: "desc" }],
        take: 500,
        include: { invoice: { select: { id: true, number: true } } },
      },
    },
  });
  if (!product) throw ApiError.notFound("Item not found.");
  const showCost = can(ctx.role, "reports.costs");
  const inStock = product.units.filter((u) => u.status === "IN_STOCK").length;
  res.json(
    present(product, inStock, showCost, {
      units: product.units.map((u) => ({ ...u, costCents: showCost ? u.costCents : null })),
    }),
  );
};

const productSchema = z.object({
  kind: z.enum(KINDS),
  brand: z.string().trim().max(80).optional().nullable(),
  name: z.string().trim().min(1, "Give the item a name.").max(120),
  size: z.string().trim().max(60).optional().nullable(),
  sku: z.string().trim().max(60).optional().nullable(),
  costCents: z.number().int().min(0).max(10_000_000).default(0),
  priceCents: z.number().int().min(0).max(10_000_000).default(0),
  reorderPoint: z.number().int().min(0).max(10_000).default(4),
});

async function receiveSerials(
  organizationId: string,
  productId: string,
  serials: string[],
  costCents: number | null,
) {
  if (serials.length > 500) {
    throw ApiError.unprocessable("Add at most 500 serial numbers at a time.");
  }
  const existing = await db.inventoryUnit.findMany({
    where: { organizationId, serialNumber: { in: serials } },
    select: { serialNumber: true },
  });
  const taken = new Set(existing.map((u) => u.serialNumber));
  const fresh = serials.filter((s) => !taken.has(s));
  if (fresh.length > 0) {
    await db.inventoryUnit.createMany({
      data: fresh.map((serialNumber) => ({
        organizationId,
        productId,
        serialNumber,
        costCents,
      })),
      skipDuplicates: true,
    });
  }
  return { added: fresh, duplicates: [...taken] };
}

export const createProduct = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const body = productSchema
    .extend({ serials: z.union([z.string().max(40_000), z.array(z.string().max(64)).max(500)]).optional() })
    .parse(req.body);

  const managesPrices = can(ctx.role, "inventory.manage");

  const product = await db.inventoryProduct.create({
    data: {
      organizationId: ctx.organizationId,
      kind: body.kind,
      brand: body.brand || null,
      name: body.name,
      size: body.size || null,
      sku: body.sku || null,
      costCents: managesPrices ? body.costCents : 0,
      priceCents: managesPrices ? body.priceCents : 0,
      reorderPoint: body.reorderPoint,
    },
  });

  const serials = body.serials ? parseSerials(body.serials) : [];
  const received = await receiveSerials(ctx.organizationId, product.id, serials, null);

  await recordAudit(db, {
    organizationId: ctx.organizationId,
    ...auditContext(req),
    action: "inventory.product_created",
    resourceType: "inventory_product",
    resourceId: product.id,
    metadata: { name: product.name, serialsAdded: received.added.length },
  });

  res.status(201).json({
    ...present(product, received.added.length, can(ctx.role, "reports.costs")),
    ...received,
  });
};

export const updateProduct = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const body = productSchema.partial().extend({ isActive: z.boolean().optional() }).parse(req.body);
  const product = await db.inventoryProduct.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!product) throw ApiError.notFound("Item not found.");

  const updated = await db.inventoryProduct.update({
    where: { id: product.id },
    data: body,
  });
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    ...auditContext(req),
    action: "inventory.product_updated",
    resourceType: "inventory_product",
    resourceId: product.id,
    metadata: body,
  });
  const counts = await inStockCounts(db, ctx.organizationId, [product.id]);
  res.json(present(updated, counts.get(product.id) ?? 0, can(ctx.role, "reports.costs")));
};

export const receiveUnits = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const body = z
    .object({
      serials: z.union([z.string().max(40_000), z.array(z.string().max(64)).max(500)]),
      costCents: z.number().int().min(0).max(10_000_000).optional(),
    })
    .parse(req.body);

  const product = await db.inventoryProduct.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!product) throw ApiError.notFound("Item not found.");

  const serials = parseSerials(body.serials);
  if (serials.length === 0) throw ApiError.unprocessable("Enter at least one serial number.");

  const unitCost =
    body.costCents !== undefined && can(ctx.role, "inventory.manage") ? body.costCents : null;
  const received = await receiveSerials(ctx.organizationId, product.id, serials, unitCost);

  await recordAudit(db, {
    organizationId: ctx.organizationId,
    ...auditContext(req),
    action: "inventory.received",
    resourceType: "inventory_product",
    resourceId: product.id,
    metadata: { added: received.added.length, duplicates: received.duplicates },
  });

  const counts = await inStockCounts(db, ctx.organizationId, [product.id]);
  res.status(201).json({
    ...received,
    product: present(product, counts.get(product.id) ?? 0, can(ctx.role, "reports.costs")),
  });
};

export const removeUnit = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const { reason } = z
    .object({ reason: z.string().trim().min(3, "Say why it is being removed.").max(300) })
    .parse(req.body);

  const unit = await db.inventoryUnit.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!unit) throw ApiError.notFound("Item not found.");
  if (unit.status !== "IN_STOCK") {
    throw ApiError.conflict("Only an item that is in stock can be removed.");
  }

  const updated = await db.$transaction(async (tx) => {
    const result = await tx.inventoryUnit.update({
      where: { id: unit.id },
      data: { status: "REMOVED", note: reason },
    });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      ...auditContext(req),
      action: "inventory.removed",
      resourceType: "inventory_unit",
      resourceId: unit.id,
      reason,
      metadata: { serialNumber: unit.serialNumber },
    });
    await flagLowStock(tx, ctx.organizationId, [unit.productId]);
    return result;
  });
  res.json(updated);
};

export const restockUnit = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const unit = await db.inventoryUnit.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!unit) throw ApiError.notFound("Item not found.");
  if (unit.status !== "REMOVED") {
    throw ApiError.conflict("Only an item that was removed can be put back in stock.");
  }
  const updated = await db.inventoryUnit.update({
    where: { id: unit.id },
    data: { status: "IN_STOCK", note: null },
  });
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    ...auditContext(req),
    action: "inventory.restocked",
    resourceType: "inventory_unit",
    resourceId: unit.id,
    metadata: { serialNumber: unit.serialNumber },
  });
  res.json(updated);
};
export const deleteProduct = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const product = await db.inventoryProduct.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!product) throw ApiError.notFound("Item not found.");

  await db.$transaction(async (tx) => {
    await tx.inventoryUnit.deleteMany({
      where: { productId: product.id, organizationId: ctx.organizationId },
    });
    await tx.inventoryProduct.delete({
      where: { id: product.id },
    });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      ...auditContext(req),
      action: "inventory.product_deleted",
      resourceType: "inventory_product",
      resourceId: product.id,
      metadata: { name: product.name, brand: product.brand, size: product.size },
    });
  });

  res.json({ success: true });
};

export const deleteUnit = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const unit = await db.inventoryUnit.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!unit) throw ApiError.notFound("Item not found.");

  await db.$transaction(async (tx) => {
    await tx.inventoryUnit.delete({ where: { id: unit.id } });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      ...auditContext(req),
      action: "inventory.unit_deleted",
      resourceType: "inventory_unit",
      resourceId: unit.id,
      metadata: { serialNumber: unit.serialNumber, productId: unit.productId },
    });
  });

  res.json({ success: true });
};
