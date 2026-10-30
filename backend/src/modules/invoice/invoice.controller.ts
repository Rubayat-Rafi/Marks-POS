import type { Request, Response } from "express";
import { z } from "zod";
import { db, type Tx } from "../../db.js";
import { ApiError } from "../../middlewares/error.middleware.js";
import { queryDate, queryEnum, queryUuid } from "../../utils/query.js";
import { auth, tenantScope } from "../../middlewares/auth.middleware.js";
import { auditContext, recordAudit } from "../../lib/audit.js";
import { decimalToNumber } from "../../lib/money.js";
import { priceLines, type TaxPolicy } from "../../domain/pricing.js";
import {
  invoiceBalance,
  issueCreditNote,
  issueInvoice,
  recognizeJobCosts,
} from "../../domain/invoicing.js";
import { deleteInvoiceTx } from "../../domain/deletion.js";

export async function taxPolicyFor(tx: Tx, organizationId: string, customerId: string): Promise<TaxPolicy> {
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

export async function listInvoices(req: Request, res: Response) {
  const unpaidOnly = req.query.unpaid === "true";
  const status = queryEnum(
    req.query.status,
    ["DRAFT", "ISSUED", "PARTLY_PAID", "PAID", "CREDITED", "VOID"] as const,
    "status",
  );
  const customerId = queryUuid(req.query.customerId, "customerId");
  const paidFrom = queryDate(req.query.paidFrom, "paidFrom");
  const invoices = await db.invoice.findMany({
    where: {
      ...tenantScope(req),
      ...(unpaidOnly ? { status: { in: ["ISSUED", "PARTLY_PAID"] } } : {}),
      ...(status ? { status } : {}),
      ...(customerId ? { customerId } : {}),
      ...(paidFrom ? { paidAt: { gte: paidFrom } } : {}),
    },
    orderBy: paidFrom ? { paidAt: "desc" } : { createdAt: "desc" },
    take: 200,
    include: {
      customer: { select: { id: true, firstName: true, lastName: true, companyName: true } },
      repairOrder: { select: { id: true, number: true } },
    },
  });

  res.json({
    data: invoices.map((i) => ({ ...i, balance: invoiceBalance(i) })),
  });
}

export async function getInvoice(req: Request, res: Response) {
  const invoice = await db.invoice.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: {
      lines: {
        orderBy: { sortOrder: "asc" },
        include: { inventoryUnits: { select: { id: true, serialNumber: true } } },
      },
      customer: true,
      location: true,
      organization: { select: { name: true, legalName: true } },
      repairOrder: { include: { vehicle: true } },
      allocations: { include: { payment: true }, orderBy: { createdAt: "asc" } },
      creditNotes: true,
      attempts: { orderBy: { createdAt: "desc" } },
      depositApplications: true,
    },
  });
  if (!invoice) throw ApiError.notFound("Invoice not found.");
  res.json({ ...invoice, balance: invoiceBalance(invoice) });
}

export async function createInvoiceFromRepairOrder(req: Request, res: Response) {
  const ctx = auth(req);

  const order = await db.repairOrder.findFirst({
    where: { id: req.params.repairOrderId, ...tenantScope(req) },
    include: {
      invoices: true,
      estimates: {
        include: {
          versions: {
            orderBy: { version: "desc" },
            include: { lines: { orderBy: { sortOrder: "asc" } }, approvals: true },
          },
        },
      },
    },
  });
  if (!order) throw ApiError.notFound("Repair order not found.");
  if (order.invoices.some((i) => i.status !== "VOID")) {
    throw ApiError.conflict("This job already has an invoice.");
  }

  const approvedLines = order.estimates
    .flatMap((e) => e.versions)
    .filter((v) => v.approvals.length > 0 && !v.approvals[0].declined)
    .flatMap((v) => v.lines.filter((l) => l.approved));

  if (approvedLines.length === 0) {
    throw ApiError.unprocessable(
      "No approved work on this job yet. Get customer approval before invoicing.",
    );
  }

  const invoice = await db.$transaction(async (tx) => {
    const policy = await taxPolicyFor(tx, ctx.organizationId, order.customerId);
    const totals = priceLines(
      approvedLines.map((l) => ({
        lineType: l.lineType,
        quantity: decimalToNumber(l.quantity),
        unitPrice: l.unitPrice,
        unitCost: l.unitCost,
        taxable: l.taxable,
      })),
      policy,
    );

    return tx.invoice.create({
      data: {
        organizationId: ctx.organizationId,
        locationId: order.locationId,
        customerId: order.customerId,
        repairOrderId: order.id,
        number: `DRAFT-${order.number}`,
        status: "DRAFT",
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        lines: {
          create: approvedLines.map((l, i) => ({
            lineType: l.lineType,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            unitCost: l.unitCost,
            hours: l.hours,
            taxable: totals.lines[i].taxRateBps > 0,
            taxRateBps: totals.lines[i].taxRateBps,
            lineTotal: totals.lines[i].lineTotal,
            taxAmount: totals.lines[i].taxAmount,
            sortOrder: i,
          })),
        },
      },
      include: { lines: true },
    });
  });

  res.status(201).json(invoice);
}

export async function issueInvoiceHandler(req: Request, res: Response) {
  const ctx = auth(req);
  const result = await db.$transaction(async (tx) => {
    const invoice = await issueInvoice(tx, {
      invoiceId: req.params.id,
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
    });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      ...auditContext(req),
      action: "invoice.issued",
      resourceType: "invoice",
      resourceId: invoice.id,
      metadata: { number: invoice.number, total: invoice.total },
    });
    return invoice;
  });

  res.json(result);
}

export async function createCreditNote(req: Request, res: Response) {
  const ctx = auth(req);
  const body = z
    .object({
      amount: z.number().int().positive(),
      taxAmount: z.number().int().min(0).default(0),
      reason: z.string().min(3, "Give a reason for the credit."),
    })
    .parse(req.body);

  const note = await db.$transaction(async (tx) => {
    const created = await issueCreditNote(tx, {
      organizationId: ctx.organizationId,
      invoiceId: req.params.id,
      amount: body.amount,
      taxAmount: body.taxAmount,
      reason: body.reason,
      actorId: ctx.userId,
    });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      ...auditContext(req),
      action: "invoice.credited",
      resourceType: "invoice",
      resourceId: req.params.id,
      reason: body.reason,
      metadata: { creditNoteNumber: created.number, amount: body.amount },
    });
    return created;
  });

  res.status(201).json(note);
}

export async function voidInvoice(req: Request, res: Response) {
  const ctx = auth(req);
  const { reason } = z
    .object({ reason: z.string().min(3, "Give a reason.") })
    .parse(req.body);

  const invoice = await db.invoice.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!invoice) throw ApiError.notFound("Invoice not found.");
  if (invoice.status !== "DRAFT") {
    throw ApiError.conflict(
      "An issued invoice cannot be voided. Issue a credit note instead so the record stays traceable.",
    );
  }

  const updated = await db.$transaction(async (tx) => {
    const result = await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: "VOID", voidedAt: new Date() },
    });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      ...auditContext(req),
      action: "invoice.voided",
      resourceType: "invoice",
      resourceId: invoice.id,
      reason,
    });
    return result;
  });

  res.json(updated);
}

export async function recognizeCosts(req: Request, res: Response) {
  const ctx = auth(req);
  const result = await db.$transaction((tx) =>
    recognizeJobCosts(tx, {
      repairOrderId: req.params.repairOrderId,
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
    }),
  );
  res.json(result);
}

export async function deleteInvoice(req: Request, res: Response) {
  const ctx = auth(req);
  const invoice = await db.invoice.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!invoice) throw ApiError.notFound("Invoice not found.");

  await db.$transaction(async (tx) => {
    await deleteInvoiceTx(tx, ctx.organizationId, invoice.id);
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      ...auditContext(req),
      action: "invoice.deleted",
      resourceType: "invoice",
      resourceId: invoice.id,
      metadata: { number: invoice.number, total: invoice.total, status: invoice.status },
    });
  });

  res.json({ success: true });
}
