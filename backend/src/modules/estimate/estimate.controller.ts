import type { Request, Response } from "express";
import { z } from "zod";
import { env } from "../../env.js";
import { db, type Tx } from "../../db.js";
import { ApiError } from "../../middlewares/error.middleware.js";
import { queryEnum, queryUuid } from "../../utils/query.js";
import { auth, resolveLocationId, tenantScope } from "../../middlewares/auth.middleware.js";
import { auditContext, recordAudit } from "../../lib/audit.js";
import { newApprovalToken, nextNumber } from "../../lib/sequences.js";
import { enqueueOutbox, OUTBOX_EVENTS } from "../../lib/outbox.js";
import { decimalToNumber } from "../../lib/money.js";
import { priceLines, type TaxPolicy } from "../../domain/pricing.js";
import { assertEstimateTransition } from "../../domain/states.js";
import { deleteEstimateTx } from "../../domain/deletion.js";

export const lineSchema = z.object({
  lineType: z.enum(["PART", "LABOR", "FEE", "SUBLET", "DISCOUNT"]),
  description: z.string().min(1, "Every line needs a description."),
  quantity: z.number().positive("Quantity must be above zero."),
  unitPrice: z.number().int().min(0, "Price is in cents and cannot be negative."),
  unitCost: z.number().int().min(0).default(0),
  hours: z.number().min(0).optional().nullable(),
  taxable: z.boolean().default(true),
  catalogItemId: z.string().uuid().optional().nullable(),
});

export async function taxPolicyFor(
  tx: Tx,
  organizationId: string,
  customerId: string,
): Promise<TaxPolicy> {
  const [org, customer] = await Promise.all([
    tx.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    tx.customer.findUniqueOrThrow({ where: { id: customerId } }),
  ]);
  return {
    taxRateBps: org.taxRateBps,
    taxesParts: org.taxesParts,
    taxesLabor: org.taxesLabor,
    taxesFees: org.taxesFees,
    customerTaxExempt: customer.taxExempt,
  };
}

export async function repriceVersion(tx: Tx, versionId: string, organizationId: string) {
  const version = await tx.estimateVersion.findUniqueOrThrow({
    where: { id: versionId },
    include: { lines: { orderBy: { sortOrder: "asc" } }, estimate: true },
  });

  const policy = await taxPolicyFor(tx, organizationId, version.estimate.customerId);
  const totals = priceLines(
    version.lines.map((l) => ({
      lineType: l.lineType,
      quantity: decimalToNumber(l.quantity),
      unitPrice: l.unitPrice,
      unitCost: l.unitCost,
      taxable: l.taxable,
    })),
    policy,
  );

  await Promise.all(
    version.lines.map((line, i) =>
      tx.estimateLine.update({
        where: { id: line.id },
        data: { lineTotal: totals.lines[i].lineTotal },
      }),
    ),
  );

  return tx.estimateVersion.update({
    where: { id: versionId },
    data: {
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      taxTotal: totals.taxTotal,
      total: totals.total,
      taxRateBps: policy.taxRateBps,
    },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function listEstimates(req: Request, res: Response) {
  const estimates = await db.estimate.findMany({
    where: {
      ...tenantScope(req),
      ...(req.query.status
        ? {
            status: queryEnum(
              req.query.status,
              ["DRAFT", "SENT", "APPROVED", "PARTLY_APPROVED", "DECLINED", "EXPIRED", "SUPERSEDED"] as const,
              "status",
            ),
          }
        : {}),
      ...(req.query.repairOrderId
        ? { repairOrderId: queryUuid(req.query.repairOrderId, "repairOrderId") }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      customer: true,
      vehicle: true,
      versions: { orderBy: { version: "desc" }, take: 1 },
    },
  });
  res.json({ data: estimates });
}

export async function getEstimate(req: Request, res: Response) {
  const estimate = await db.estimate.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: {
      customer: true,
      vehicle: true,
      versions: {
        orderBy: { version: "desc" },
        include: {
          lines: { orderBy: { sortOrder: "asc" } },
          approvals: { orderBy: { createdAt: "desc" } },
        },
      },
    },
  });
  if (!estimate) throw ApiError.notFound("Estimate not found.");
  res.json(estimate);
}

export async function createEstimate(req: Request, res: Response) {
  const ctx = auth(req);
  const body = z
    .object({
      customerId: z.string().uuid(),
      vehicleId: z.string().uuid(),
      repairOrderId: z.string().uuid().optional().nullable(),
      locationId: z.string().uuid().optional(),
      notes: z.string().optional(),
      lines: z.array(lineSchema).default([]),
    })
    .parse(req.body);

  const locationId = await resolveLocationId(req, body.locationId);
  const [customer, vehicle] = await Promise.all([
    db.customer.findFirst({ where: { id: body.customerId, ...tenantScope(req) } }),
    db.vehicle.findFirst({ where: { id: body.vehicleId, ...tenantScope(req) } }),
  ]);
  if (!customer) throw ApiError.notFound("Customer not found.");
  if (!vehicle) throw ApiError.notFound("Vehicle not found.");

  const estimate = await db.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.organizationId, "estimate");
    const created = await tx.estimate.create({
      data: {
        organizationId: ctx.organizationId,
        locationId,
        customerId: body.customerId,
        vehicleId: body.vehicleId,
        repairOrderId: body.repairOrderId ?? null,
        number,
        createdById: ctx.userId,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
        versions: {
          create: {
            version: 1,
            notes: body.notes,
            lines: {
              create: body.lines.map((l, i) => ({ ...l, sortOrder: i })),
            },
          },
        },
      },
      include: { versions: true },
    });

    await repriceVersion(tx, created.versions[0].id, ctx.organizationId);
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      ...auditContext(req),
      action: "estimate.created",
      resourceType: "estimate",
      resourceId: created.id,
      metadata: { number },
    });
    return created;
  });

  res.status(201).json(estimate);
}

export async function updateVersionLines(req: Request, res: Response) {
  const ctx = auth(req);
  const { lines, notes } = z
    .object({ lines: z.array(lineSchema), notes: z.string().optional() })
    .parse(req.body);

  const version = await db.estimateVersion.findFirst({
    where: { id: req.params.versionId, estimate: { ...tenantScope(req) } },
    include: { estimate: true },
  });
  if (!version) throw ApiError.notFound("Estimate version not found.");
  if (version.frozenAt) {
    throw ApiError.conflict(
      "This version has been sent to the customer and cannot be edited. Create a revision instead.",
    );
  }

  const updated = await db.$transaction(async (tx) => {
    await tx.estimateLine.deleteMany({ where: { estimateVersionId: version.id } });
    await tx.estimateVersion.update({
      where: { id: version.id },
      data: {
        notes,
        lines: { create: lines.map((l, i) => ({ ...l, sortOrder: i })) },
      },
    });
    return repriceVersion(tx, version.id, ctx.organizationId);
  });

  res.json(updated);
}

export async function sendVersion(req: Request, res: Response) {
  const ctx = auth(req);
  const version = await db.estimateVersion.findFirst({
    where: { id: req.params.versionId, estimate: { ...tenantScope(req) } },
    include: { estimate: { include: { customer: true } }, lines: true },
  });
  if (!version) throw ApiError.notFound("Estimate version not found.");
  if (version.lines.length === 0) {
    throw ApiError.unprocessable("Add at least one line before sending.");
  }
  assertEstimateTransition(version.status, "SENT");

  const token = newApprovalToken();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

  const result = await db.$transaction(async (tx) => {
    const updated = await tx.estimateVersion.update({
      where: { id: version.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        frozenAt: new Date(),
        approvalToken: token,
        approvalTokenExpiresAt: expiresAt,
      },
    });
    await tx.estimate.update({
      where: { id: version.estimateId },
      data: { status: "SENT" },
    });

    await enqueueOutbox(tx, ctx.organizationId, OUTBOX_EVENTS.ESTIMATE_SENT, {
      estimateId: version.estimateId,
      versionId: version.id,
      customerId: version.estimate.customerId,
      email: version.estimate.customer.email,
      approvalUrl: `${env.publicWebUrl}/approve/${token}`,
    });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      ...auditContext(req),
      action: "estimate.sent",
      resourceType: "estimate_version",
      resourceId: version.id,
    });
    return updated;
  });

  res.json({
    ...result,
    approvalUrl: `${env.publicWebUrl}/approve/${token}`,
  });
}

export async function reviseEstimate(req: Request, res: Response) {
  const ctx = auth(req);
  const { lines, notes } = z
    .object({ lines: z.array(lineSchema), notes: z.string().optional() })
    .parse(req.body);

  const estimate = await db.estimate.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!estimate) throw ApiError.notFound("Estimate not found.");

  const previous = estimate.versions[0];
  const result = await db.$transaction(async (tx) => {
    if (previous) {
      await tx.estimateVersion.update({
        where: { id: previous.id },
        data: {
          status: "SUPERSEDED",
          approvalToken: null,
          approvalTokenExpiresAt: null,
        },
      });
    }

    const version = await tx.estimateVersion.create({
      data: {
        estimateId: estimate.id,
        version: (previous?.version ?? 0) + 1,
        notes,
        lines: { create: lines.map((l, i) => ({ ...l, sortOrder: i })) },
      },
    });
    await tx.estimate.update({
      where: { id: estimate.id },
      data: { currentVersion: version.version, status: "DRAFT" },
    });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      ...auditContext(req),
      action: "estimate.revised",
      resourceType: "estimate_version",
      resourceId: version.id,
      reason: "Additional work requires new authorization.",
      metadata: { supersededVersionId: previous?.id },
    });

    return repriceVersion(tx, version.id, ctx.organizationId);
  });

  res.status(201).json(result);
}

export async function deleteEstimate(req: Request, res: Response) {
  const ctx = auth(req);
  const estimate = await db.estimate.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!estimate) throw ApiError.notFound("Estimate not found.");

  await db.$transaction(async (tx) => {
    await deleteEstimateTx(tx, ctx.organizationId, estimate.id);
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      ...auditContext(req),
      action: "estimate.deleted",
      resourceType: "estimate",
      resourceId: estimate.id,
      metadata: { number: estimate.number },
    });
  });

  res.json({ success: true });
}
