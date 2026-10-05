import { type Request, type Response } from "express";
import { z } from "zod";
import { db, type Tx } from "../../db.js";
import { ApiError } from "../../middlewares/error.middleware.js";
import { auth, resolveLocationId } from "../../middlewares/auth.middleware.js";
import { assertPermission } from "../../middlewares/rbac.middleware.js";
import { auditContext, recordAudit } from "../../lib/audit.js";
import { priceLines, type PricingLineInput } from "../../domain/pricing.js";
import {
  assertWithinBalance,
  invoiceBalance,
  issueInvoice,
  recordPayment,
  refreshInvoiceTotals,
} from "../../domain/invoicing.js";
import { flagLowStock, sellUnits } from "../../domain/inventory.js";
import { MANUAL_METHODS } from "../../domain/payments.js";

const lineSchema = z.object({
  lineType: z.enum(["LABOR", "PART", "FEE", "DISCOUNT"]),
  description: z.string().trim().min(1, "Describe the work or part.").max(200),
  quantity: z.number().positive().max(1000).default(1),
  unitPrice: z.number().int().min(0).max(10_000_000),
  taxable: z.boolean().default(true),
  unitIds: z.array(z.string().uuid()).max(50).default([]),
  department: z.enum(["TIRE", "MUFFLER", "OTHER"]).optional(),
});

const saleSchema = z.object({
  idempotencyKey: z.string().min(8).max(100).regex(/^[\w-]+$/),
  customerId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  department: z.enum(["TIRE", "MUFFLER", "OTHER"]).optional(),
  customer: z
    .object({
      name: z.string().trim().max(120).optional(),
      phone: z.string().trim().max(30).optional(),
      email: z.string().trim().email().max(254).optional().or(z.literal("")),
    })
    .optional(),
  vehicle: z
    .object({
      year: z.number().int().min(1900).max(2100).optional().nullable(),
      make: z.string().trim().max(40).optional().nullable(),
      model: z.string().trim().max(60).optional().nullable(),
      plate: z.string().trim().max(15).optional().nullable(),
      vin: z.string().trim().max(17).optional().nullable(),
      mileageIn: z.number().int().min(0).max(2_000_000).optional().nullable(),
    })
    .optional(),
  lines: z.array(lineSchema).min(1, "Add at least one line.").max(60),
  customTaxRateBps: z.number().int().min(0).max(10_000).optional(),
  customTaxAmount: z.number().int().min(0).optional(),
  notes: z.string().trim().max(1000).optional(),
  payment: z
    .object({
      method: z.enum(MANUAL_METHODS),
      amount: z.number().int().positive().optional(),
      reference: z.string().trim().max(60).optional(),
      tendered: z.number().int().positive().optional(),
    })
    .optional(),
});

type SaleInput = z.infer<typeof saleSchema>;
type Line = z.infer<typeof lineSchema>;

const digits = (value?: string | null) => (value ?? "").replace(/\D/g, "");

async function loadUnits(tx: Tx, organizationId: string, lines: Line[]) {
  const ids = lines.flatMap((l) => l.unitIds);
  if (new Set(ids).size !== ids.length) {
    throw ApiError.unprocessable("The same serial number is on the ticket twice.");
  }
  if (ids.length === 0) {
    return new Map<
      string,
      { id: string; productId: string; serialNumber: string; costCents: number | null; product: { costCents: number } }
    >();
  }
  const units = await tx.inventoryUnit.findMany({
    where: { id: { in: ids }, organizationId },
    include: { product: { select: { costCents: true } } },
  });
  const byId = new Map(units.map((u) => [u.id, u]));
  for (const id of ids) {
    const unit = byId.get(id);
    if (!unit) throw ApiError.unprocessable("One of the selected items is not in this shop's inventory.");
    if (unit.status !== "IN_STOCK") {
      throw ApiError.conflict(`Serial ${unit.serialNumber} is no longer in stock. Pick another.`);
    }
  }
  return byId;
}

function pricingInput(lines: Line[], units: Awaited<ReturnType<typeof loadUnits>>): PricingLineInput[] {
  return lines.map((line) => {
    if (line.unitIds.length === 0) {
      return {
        lineType: line.lineType,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        unitCost: 0,
        taxable: line.taxable,
      };
    }
    const costs = line.unitIds.map((id) => {
      const unit = units.get(id)!;
      return unit.costCents ?? unit.product.costCents;
    });
    return {
      lineType: "PART",
      quantity: line.unitIds.length,
      unitPrice: line.unitPrice,
      unitCost: Math.round(costs.reduce((a, b) => a + b, 0) / costs.length),
      taxable: line.taxable,
    };
  });
}

async function taxPolicy(tx: Tx, organizationId: string, customerTaxExempt: boolean) {
  const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
  return {
    taxRateBps: org.taxRateBps,
    taxesParts: org.taxesParts,
    taxesLabor: org.taxesLabor,
    taxesFees: org.taxesFees,
    customerTaxExempt,
  };
}

async function resolveCustomer(tx: Tx, organizationId: string, input: SaleInput) {
  if (input.customerId) {
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, organizationId } });
    if (!customer) throw ApiError.notFound("Customer not found.");
    return customer;
  }

  const name = input.customer?.name?.trim() ?? "";
  const phone = input.customer?.phone?.trim() ?? "";
  const phoneDigits = digits(phone).slice(-10);

  if (phoneDigits.length >= 7) {
    const match = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT \`id\` FROM \`customers\`
      WHERE \`organizationId\` = ${organizationId}
        AND \`archivedAt\` IS NULL
        AND RIGHT(REGEXP_REPLACE(COALESCE(\`phone\`, ''), '[^0-9]', ''), 10) = ${phoneDigits}
      ORDER BY \`createdAt\` ASC
      LIMIT 1
    `;
    if (match[0]) return tx.customer.findUniqueOrThrow({ where: { id: match[0].id } });
  }

  if (!name && !phoneDigits) {
    const walkIn = await tx.customer.findFirst({
      where: { organizationId, firstName: "Walk-in", lastName: "Customer", phone: null },
    });
    if (walkIn) return walkIn;
    return tx.customer.create({
      data: { organizationId, firstName: "Walk-in", lastName: "Customer", allowsSms: false },
    });
  }

  const [first, ...rest] = (name || "Customer").split(/\s+/);
  return tx.customer.create({
    data: {
      organizationId,
      firstName: first,
      lastName: rest.join(" ") || "-",
      phone: phone || null,
      email: input.customer?.email || null,
    },
  });
}

export const previewSale = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const body = z
    .object({
      lines: z.array(lineSchema).max(60),
      customerId: z.string().uuid().optional(),
      customTaxRateBps: z.number().int().min(0).max(10_000).optional(),
      customTaxAmount: z.number().int().min(0).optional(),
    })
    .parse(req.body);

  let exempt = false;
  if (body.customerId) {
    const customer = await db.customer.findFirst({
      where: { id: body.customerId, organizationId: ctx.organizationId },
    });
    exempt = customer?.taxExempt ?? false;
  }
  const units = await loadUnits(db, ctx.organizationId, body.lines);
  const policy = await taxPolicy(db, ctx.organizationId, exempt);
  if (body.customTaxRateBps !== undefined) {
    policy.taxRateBps = body.customTaxRateBps;
    if (body.customTaxRateBps > 0) {
      policy.taxesLabor = true;
      policy.taxesParts = true;
      policy.taxesFees = true;
    }
  }
  const totals = priceLines(pricingInput(body.lines, units), policy);
  if (body.customTaxAmount !== undefined) {
    totals.taxTotal = body.customTaxAmount;
    totals.total = totals.subtotal - totals.discountTotal + totals.taxTotal;
  }
  res.json({
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    taxTotal: totals.taxTotal,
    total: totals.total,
    lines: totals.lines.map((l) => ({ lineTotal: l.lineTotal, taxAmount: l.taxAmount })),
  });
};

export const createQuickSale = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const body = saleSchema.parse(req.body);
  if (body.payment) assertPermission(ctx.role, "payments.collect");
  if (body.payment?.tendered !== undefined && body.payment.method !== "CASH") {
    throw ApiError.badRequest("Cash tendered only applies to cash payments.");
  }

  const replay = await db.invoice.findFirst({
    where: { organizationId: ctx.organizationId, idempotencyKey: body.idempotencyKey },
  });
  if (replay) {
    res.json({ invoiceId: replay.id, number: replay.number, balance: invoiceBalance(replay), duplicate: true });
    return;
  }

  const locationId = await resolveLocationId(req, body.locationId);

  try {
    const result = await db.$transaction(async (tx) => {
      const customer = await resolveCustomer(tx, ctx.organizationId, body);
      const units = await loadUnits(tx, ctx.organizationId, body.lines);
      const policy = await taxPolicy(tx, ctx.organizationId, customer.taxExempt);
      if (body.customTaxRateBps !== undefined) {
        policy.taxRateBps = body.customTaxRateBps;
        if (body.customTaxRateBps > 0) {
          policy.taxesLabor = true;
          policy.taxesParts = true;
          policy.taxesFees = true;
        }
      }
      const totals = priceLines(pricingInput(body.lines, units), policy);
      if (body.customTaxAmount !== undefined) {
        totals.taxTotal = body.customTaxAmount;
        totals.total = totals.subtotal - totals.discountTotal + totals.taxTotal;
      }
      if (totals.total < 0) {
        throw ApiError.unprocessable("Discounts are larger than the sale.");
      }

      const invoice = await tx.invoice.create({
        data: {
          organizationId: ctx.organizationId,
          locationId,
          customerId: customer.id,
          number: `DRAFT-QS-${body.idempotencyKey.slice(0, 12)}`,
          status: "DRAFT",
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          taxTotal: totals.taxTotal,
          total: totals.total,
          notes: body.notes || null,
          idempotencyKey: body.idempotencyKey,
        },
      });

      const soldProductIds = new Set<string>();
      for (const [i, line] of body.lines.entries()) {
        const priced = totals.lines[i];
        let description = line.description;
        const lineDept = line.department || body.department;
        if (lineDept === "TIRE" && !description.toLowerCase().includes("tire") && !description.includes("[Tire")) {
          description = `[Tires] ${description}`;
        } else if (lineDept === "MUFFLER" && !description.toLowerCase().includes("muffler") && !description.toLowerCase().includes("exhaust") && !description.includes("[Muffler")) {
          description = `[Mufflers] ${description}`;
        }

        const created = await tx.invoiceLine.create({
          data: {
            invoiceId: invoice.id,
            lineType: priced.lineType,
            description,
            quantity: priced.quantity,
            unitPrice: priced.unitPrice,
            unitCost: priced.unitCost ?? 0,
            taxable: priced.taxRateBps > 0,
            taxRateBps: priced.taxRateBps,
            lineTotal: priced.lineTotal,
            taxAmount: priced.taxAmount,
            sortOrder: i,
          },
        });
        if (line.unitIds.length > 0) {
          await sellUnits(tx, {
            organizationId: ctx.organizationId,
            unitIds: line.unitIds,
            invoiceId: invoice.id,
            invoiceLineId: created.id,
          });
          for (const id of line.unitIds) soldProductIds.add(units.get(id)!.productId);
        }
      }

      const v = body.vehicle;
      const hasVehicle = v && Object.values(v).some((x) => x !== null && x !== undefined && x !== "");
      const issued = await issueInvoice(tx, {
        invoiceId: invoice.id,
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        vehicleSnapshot: hasVehicle
          ? {
              year: v!.year ?? null,
              make: v!.make || null,
              model: v!.model || null,
              plate: v!.plate || null,
              vin: v!.vin || null,
              mileageIn: v!.mileageIn ?? null,
            }
          : undefined,
      });

      let paid = 0;
      if (body.payment && issued.total > 0) {
        const amount = body.payment.amount ?? issued.total;
        assertWithinBalance(amount, issued.total);
        if (body.payment.tendered !== undefined && body.payment.tendered < amount) {
          throw ApiError.unprocessable("Cash received is less than the amount being paid.");
        }
        const payKey = `${body.idempotencyKey}-pay`;
        const attempt = await tx.paymentAttempt.create({
          data: {
            organizationId: ctx.organizationId,
            invoiceId: invoice.id,
            provider: "manual",
            method: body.payment.method,
            amount,
            currency: issued.currency,
            idempotencyKey: payKey,
            status: "SUCCEEDED",
            externalId: `manual_${payKey}`,
            resolvedAt: new Date(),
          },
        });
        await recordPayment(tx, {
          organizationId: ctx.organizationId,
          invoiceId: invoice.id,
          customerId: customer.id,
          amount,
          method: body.payment.method,
          provider: "manual",
          externalId: attempt.externalId,
          attemptId: attempt.id,
          actorId: ctx.userId,
          reference: body.payment.reference || null,
          tenderedAmount: body.payment.tendered ?? null,
        });
        paid = amount;
      } else if (issued.total === 0) {
        await refreshInvoiceTotals(tx, invoice.id);
      }

      const lowStock = await flagLowStock(tx, ctx.organizationId, [...soldProductIds]);

      await recordAudit(tx, {
        organizationId: ctx.organizationId,
        ...auditContext(req),
        action: "sale.quick",
        resourceType: "invoice",
        resourceId: invoice.id,
        metadata: {
          number: issued.number,
          total: issued.total,
          paid,
          method: body.payment?.method ?? null,
          serials: body.lines.flatMap((l) => l.unitIds).length,
        },
      });

      return {
        invoiceId: invoice.id,
        number: issued.number,
        total: issued.total,
        paid,
        balance: issued.total - paid,
        change:
          body.payment?.tendered !== undefined ? body.payment.tendered - paid : 0,
        lowStock,
      };
    });
    res.status(201).json(result);
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      const winner = await db.invoice.findFirst({
        where: { organizationId: ctx.organizationId, idempotencyKey: body.idempotencyKey },
      });
      if (winner) {
        res.json({ invoiceId: winner.id, number: winner.number, balance: invoiceBalance(winner), duplicate: true });
        return;
      }
    }
    throw error;
  }
};
