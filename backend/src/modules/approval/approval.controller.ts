import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../db.js";
import { ApiError } from "../../middlewares/error.middleware.js";
import { recordAudit } from "../../lib/audit.js";
import { enqueueOutbox, OUTBOX_EVENTS } from "../../lib/outbox.js";
import { decimalToNumber } from "../../lib/money.js";
import { priceLines } from "../../domain/pricing.js";

export async function loadByToken(token: string) {
  const version = await db.estimateVersion.findUnique({
    where: { approvalToken: token },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      approvals: true,
      estimate: {
        include: {
          customer: true,
          vehicle: true,
          location: true,
          organization: true,
        },
      },
    },
  });

  if (!version) throw ApiError.notFound("This approval link is not valid.");
  if (version.status === "SUPERSEDED") {
    throw ApiError.conflict(
      "This estimate has been updated since it was sent. Your shop will send a new link.",
    );
  }
  if (
    version.approvalTokenExpiresAt &&
    version.approvalTokenExpiresAt.getTime() < Date.now()
  ) {
    throw ApiError.conflict("This approval link has expired. Ask your shop for a new one.");
  }
  return version;
}

export async function getApprovalByToken(req: Request, res: Response) {
  const version = await loadByToken(req.params.token);
  const decided = version.approvals.length > 0;

  res.json({
    estimateNumber: version.estimate.number,
    versionNumber: version.version,
    status: version.status,
    alreadyDecided: decided,
    shop: {
      name: version.estimate.organization.name,
      location: version.estimate.location.name,
      phone: version.estimate.location.phone,
    },
    customerName: `${version.estimate.customer.firstName} ${version.estimate.customer.lastName}`,
    vehicle: {
      year: version.estimate.vehicle.year,
      make: version.estimate.vehicle.make,
      model: version.estimate.vehicle.model,
      plate: version.estimate.vehicle.plate,
    },
    currency: version.currency,
    lines: version.lines.map((l) => ({
      id: l.id,
      lineType: l.lineType,
      description: l.description,
      quantity: decimalToNumber(l.quantity),
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
    })),
    subtotal: version.subtotal,
    discountTotal: version.discountTotal,
    taxTotal: version.taxTotal,
    total: version.total,
    notes: version.notes,
    expiresAt: version.approvalTokenExpiresAt,
  });
}

const decisionSchema = z.object({
  decision: z.enum(["approve", "decline"]),
  approvedLineIds: z.array(z.string().uuid()).optional(),
  approverName: z.string().min(1, "Enter your name."),
});

export async function submitApprovalDecision(req: Request, res: Response) {
  const body = decisionSchema.parse(req.body);
  const version = await loadByToken(req.params.token);

  if (version.approvals.length > 0) {
    throw ApiError.conflict("A decision has already been recorded for this estimate.");
  }

  const org = version.estimate.organization;
  const declined = body.decision === "decline";

  const approvedIds = declined
    ? []
    : (body.approvedLineIds ?? version.lines.map((l) => l.id));
  const unknown = approvedIds.filter((id) => !version.lines.some((l) => l.id === id));
  if (unknown.length > 0) {
    throw ApiError.unprocessable("Some selected lines are not part of this estimate.");
  }

  const approvedLines = version.lines.filter((l) => approvedIds.includes(l.id));
  const approvedTotals = priceLines(
    approvedLines.map((l) => ({
      lineType: l.lineType,
      quantity: decimalToNumber(l.quantity),
      unitPrice: l.unitPrice,
      unitCost: l.unitCost,
      taxable: l.taxable,
    })),
    {
      taxRateBps: version.taxRateBps,
      taxesParts: org.taxesParts,
      taxesLabor: org.taxesLabor,
      taxesFees: org.taxesFees,
      customerTaxExempt: version.estimate.customer.taxExempt,
    },
  );

  const partial = !declined && approvedLines.length < version.lines.length;
  const newStatus = declined ? "DECLINED" : partial ? "PARTLY_APPROVED" : "APPROVED";

  const approval = await db.$transaction(async (tx) => {
    const claimed = await tx.estimateVersion.updateMany({
      where: { id: version.id, approvalToken: req.params.token },
      data: { approvalToken: null },
    });
    if (claimed.count === 0) {
      throw ApiError.conflict("A decision has already been recorded for this estimate.");
    }

    const created = await tx.estimateApproval.create({
      data: {
        estimateVersionId: version.id,
        approvedLineIds: approvedIds,
        approvedTotal: declined ? 0 : approvedTotals.total,
        partial,
        declined,
        approverName: body.approverName,
        approverIp: req.ip ?? null,
        userAgent: String(req.headers["user-agent"] ?? "").slice(0, 500),
      },
    });

    await tx.estimateLine.updateMany({
      where: { id: { in: approvedIds } },
      data: { approved: true },
    });
    await tx.estimateVersion.update({
      where: { id: version.id },
      data: {
        status: newStatus,
        approvalToken: null,
      },
    });
    await tx.estimate.update({
      where: { id: version.estimateId },
      data: { status: newStatus },
    });

    if (version.estimate.repairOrderId) {
      await tx.repairOrder.update({
        where: { id: version.estimate.repairOrderId },
        data: { status: declined ? "QUALITY_CHECK" : "IN_PROGRESS" },
      });
    }

    await enqueueOutbox(
      tx,
      org.id,
      declined ? OUTBOX_EVENTS.ESTIMATE_DECLINED : OUTBOX_EVENTS.ESTIMATE_APPROVED,
      {
        estimateId: version.estimateId,
        versionId: version.id,
        customerId: version.estimate.customerId,
        approvedTotal: created.approvedTotal,
        partial,
      },
    );

    await recordAudit(tx, {
      organizationId: org.id,
      actorId: null,
      action: declined ? "estimate.declined_by_customer" : "estimate.approved_by_customer",
      resourceType: "estimate_version",
      resourceId: version.id,
      reason: `${body.approverName} via web link`,
      metadata: {
        approvedLineIds: approvedIds,
        approvedTotal: created.approvedTotal,
        partial,
      },
      ip: req.ip,
    });

    return created;
  });

  res.status(201).json({
    ok: true,
    decision: body.decision,
    partial,
    approvedTotal: approval.approvedTotal,
  });
}
