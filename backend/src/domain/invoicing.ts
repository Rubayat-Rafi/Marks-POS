import type { InvoiceStatus, PaymentMethod } from "@prisma/client";
import type { Tx } from "../lib/prisma.js";
import { ApiError } from "../middlewares/error.middleware.js";
import { decimalToNumber, formatCents } from "../lib/money.js";
import { nextNumber } from "../lib/sequences.js";
import { enqueueOutbox, OUTBOX_EVENTS } from "../lib/outbox.js";
import { ACCOUNT_CODES, revenueAccountFor, type AccountCode } from "./accounts.js";
import { postJournalEntry } from "./ledger.js";
import { assertInvoiceTransition } from "./states.js";

/**
 * Issuing an invoice freezes the sale and posts revenue.
 *
 * Posting policy (build guide / 07 and / 08):
 *   Dr Accounts receivable        total
 *     Cr Parts / Labor / Fee revenue   per line type
 *     Cr Sales tax payable             tax
 *   Dr Sales discounts            discount
 *
 * Estimates and customer approvals post nothing. Revenue is recognised here.
 */
export async function issueInvoice(
  tx: Tx,
  params: {
    invoiceId: string;
    organizationId: string;
    actorId?: string | null;
    /** A counter sale has no repair order; its vehicle is typed in directly. */
    vehicleSnapshot?: Record<string, string | number | null>;
  },
) {
  const invoice = await tx.invoice.findFirst({
    where: { id: params.invoiceId, organizationId: params.organizationId },
    include: {
      lines: true,
      customer: true,
      repairOrder: { include: { vehicle: true } },
    },
  });
  if (!invoice) throw ApiError.notFound("Invoice not found.");
  assertInvoiceTransition(invoice.status, "ISSUED");
  if (invoice.lines.length === 0) {
    throw ApiError.unprocessable("An invoice needs at least one line before it is issued.");
  }

  const number =
    invoice.number && !invoice.number.startsWith("DRAFT-")
      ? invoice.number
      : await nextNumber(tx, params.organizationId, "invoice");

  const issuedAt = new Date();
  const dueAt = new Date(issuedAt.getTime() + 1000 * 60 * 60 * 24 * 14);

  // Revenue is split by line type so the margin report can read it back.
  const revenueByAccount = new Map<AccountCode, number>();
  let discountTotal = 0;
  for (const line of invoice.lines) {
    if (line.lineType === "DISCOUNT") {
      discountTotal += Math.abs(line.lineTotal);
      continue;
    }
    const account = revenueAccountFor(line.lineType);
    revenueByAccount.set(account, (revenueByAccount.get(account) ?? 0) + line.lineTotal);
  }

  const updated = await tx.invoice.update({
    where: { id: invoice.id },
    data: {
      number,
      status: "ISSUED",
      issuedAt,
      dueAt,
      version: { increment: 1 },
      // Frozen customer and vehicle details as of issuance. Later edits to the
      // customer record must not rewrite history.
      billToSnapshot: {
        name: `${invoice.customer.firstName} ${invoice.customer.lastName}`,
        companyName: invoice.customer.companyName,
        email: invoice.customer.email,
        phone: invoice.customer.phone,
        addressLine1: invoice.customer.addressLine1,
        city: invoice.customer.city,
        state: invoice.customer.state,
        postalCode: invoice.customer.postalCode,
        taxExempt: invoice.customer.taxExempt,
      },
      vehicleSnapshot: params.vehicleSnapshot
        ? params.vehicleSnapshot
        : invoice.repairOrder?.vehicle
        ? {
            vin: invoice.repairOrder.vehicle.vin,
            year: invoice.repairOrder.vehicle.year,
            make: invoice.repairOrder.vehicle.make,
            model: invoice.repairOrder.vehicle.model,
            plate: invoice.repairOrder.vehicle.plate,
            mileageIn: invoice.repairOrder.mileageIn,
          }
        : undefined,
    },
  });

  await postJournalEntry(tx, {
    organizationId: params.organizationId,
    memo: `Issue invoice ${number}`,
    sourceType: "invoice",
    sourceId: invoice.id,
    postedById: params.actorId,
    entryDate: issuedAt,
    lines: [
      { account: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, debit: invoice.total },
      ...(discountTotal > 0
        ? [{ account: ACCOUNT_CODES.SALES_DISCOUNTS, debit: discountTotal }]
        : []),
      ...[...revenueByAccount.entries()].map(([account, amount]) => ({
        account,
        credit: amount,
      })),
      ...(invoice.taxTotal > 0
        ? [{ account: ACCOUNT_CODES.SALES_TAX_PAYABLE, credit: invoice.taxTotal }]
        : []),
    ],
  });

  await enqueueOutbox(tx, params.organizationId, OUTBOX_EVENTS.INVOICE_ISSUED, {
    invoiceId: invoice.id,
    number,
    total: invoice.total,
    customerId: invoice.customerId,
  });

  return updated;
}

/**
 * Recognise what the job actually consumed: parts out of inventory and the
 * direct labor cost. Kept separate from the sale so a missing cost is visible
 * rather than silently inflating margin (build guide / 07).
 */
export async function recognizeJobCosts(
  tx: Tx,
  params: { repairOrderId: string; organizationId: string; actorId?: string | null },
) {
  const ro = await tx.repairOrder.findFirst({
    where: { id: params.repairOrderId, organizationId: params.organizationId },
    include: {
      partUsages: true,
      invoices: { include: { lines: true } },
    },
  });
  if (!ro) throw ApiError.notFound("Repair order not found.");

  const already = await tx.journalEntry.findFirst({
    where: { sourceType: "job_costs", sourceId: ro.id },
  });
  if (already) throw ApiError.conflict("Costs for this job have already been recognised.");

  const partsCost = ro.partUsages
    .filter((p) => !p.returned)
    .reduce((sum, p) => sum + Math.round(decimalToNumber(p.quantity) * p.unitCost), 0);

  const laborCost = ro.invoices
    .flatMap((i) => i.lines)
    .filter((l) => l.lineType === "LABOR")
    .reduce((sum, l) => sum + Math.round(decimalToNumber(l.quantity) * l.unitCost), 0);

  const subletCost = ro.invoices
    .flatMap((i) => i.lines)
    .filter((l) => l.lineType === "SUBLET")
    .reduce((sum, l) => sum + Math.round(decimalToNumber(l.quantity) * l.unitCost), 0);

  if (partsCost + laborCost + subletCost === 0) {
    throw ApiError.unprocessable(
      "No costs recorded on this job yet. Add parts used or labor cost first.",
    );
  }

  await postJournalEntry(tx, {
    organizationId: params.organizationId,
    memo: `Recognise costs on ${ro.number}`,
    sourceType: "job_costs",
    sourceId: ro.id,
    postedById: params.actorId,
    lines: [
      { account: ACCOUNT_CODES.PARTS_COST, debit: partsCost },
      { account: ACCOUNT_CODES.DIRECT_LABOR_COST, debit: laborCost },
      { account: ACCOUNT_CODES.SUBLET_COST, debit: subletCost },
      { account: ACCOUNT_CODES.INVENTORY, credit: partsCost },
      { account: ACCOUNT_CODES.LABOR_ALLOCATION, credit: laborCost },
      { account: ACCOUNT_CODES.ACCOUNTS_PAYABLE, credit: subletCost },
    ],
  });

  return tx.repairOrder.update({
    where: { id: ro.id },
    data: { costsProvisional: false },
  });
}

function clearingAccountFor(method: PaymentMethod) {
  if (method === "CASH" || method === "CHECK") return ACCOUNT_CODES.CASH_DRAWER;
  return ACCOUNT_CODES.PROCESSOR_CLEARING;
}

/**
 * Store the payment, allocate it against the invoice and post the ledger, all
 * inside one transaction and exactly once (build guide / 09).
 */
export async function recordPayment(
  tx: Tx,
  params: {
    organizationId: string;
    invoiceId: string;
    customerId: string;
    amount: number;
    feeAmount?: number;
    method: PaymentMethod;
    provider: string;
    externalId?: string | null;
    attemptId?: string | null;
    actorId?: string | null;
    reference?: string | null;
    tenderedAmount?: number | null;
  },
) {
  const invoice = await tx.invoice.findFirst({
    where: { id: params.invoiceId, organizationId: params.organizationId },
  });
  if (!invoice) throw ApiError.notFound("Invoice not found.");
  // A provider payment that settles after the invoice was paid another way is
  // still real money and must be recorded (as a customer credit below), so
  // only an invoice that was never issued, or was voided, refuses it here.
  if (invoice.status === "DRAFT") {
    throw ApiError.unprocessable("Issue the invoice before collecting payment.");
  }
  if (invoice.status === "VOID") {
    throw ApiError.unprocessable("That invoice is void.");
  }

  // A repeat of the same provider payment must not allocate twice.
  if (params.externalId) {
    const existing = await tx.payment.findFirst({
      where: { organizationId: params.organizationId, provider: params.provider, externalId: params.externalId },
      include: { allocations: true },
    });
    if (existing) return existing;
  }

  const balance = invoiceBalance(invoice);
  const allocated = Math.min(params.amount, balance);
  const excess = params.amount - allocated;

  const payment = await tx.payment.create({
    data: {
      organizationId: params.organizationId,
      customerId: params.customerId,
      attemptId: params.attemptId ?? null,
      provider: params.provider,
      method: params.method,
      amount: params.amount,
      feeAmount: params.feeAmount ?? 0,
      externalId: params.externalId ?? null,
      recordedById: params.actorId ?? null,
      reference: params.reference ?? null,
      tenderedAmount: params.tenderedAmount ?? null,
      allocations:
        allocated > 0
          ? { create: [{ invoiceId: invoice.id, amount: allocated }] }
          : undefined,
    },
    include: { allocations: true },
  });

  // Over-collection becomes an explicit customer credit, never a silent
  // negative balance (build guide / 09).
  if (excess > 0) {
    await tx.customerDeposit.create({
      data: {
        organizationId: params.organizationId,
        customerId: params.customerId,
        amount: excess,
        note: `Excess collection on ${invoice.number}`,
      },
    });
    await tx.reconciliationItem.create({
      data: {
        organizationId: params.organizationId,
        kind: "over_collection",
        reference: invoice.number,
        amount: excess,
        detail: `Collected ${params.amount} against a balance of ${balance}. Excess held as a customer credit.`,
      },
    });
  }

  const clearing = clearingAccountFor(params.method);
  await postJournalEntry(tx, {
    organizationId: params.organizationId,
    memo: `Payment on ${invoice.number}`,
    sourceType: "payment",
    sourceId: payment.id,
    postedById: params.actorId,
    lines: [
      { account: clearing, debit: params.amount },
      { account: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, credit: allocated },
      ...(excess > 0
        ? [{ account: ACCOUNT_CODES.CUSTOMER_DEPOSITS, credit: excess }]
        : []),
    ],
  });

  // The processor fee is an expense against clearing, not a second sale.
  if ((params.feeAmount ?? 0) > 0) {
    await postJournalEntry(tx, {
      organizationId: params.organizationId,
      memo: `Processing fee on ${invoice.number}`,
      sourceType: "processing_fee",
      sourceId: payment.id,
      postedById: params.actorId,
      lines: [
        { account: ACCOUNT_CODES.PROCESSING_FEES, debit: params.feeAmount! },
        { account: ACCOUNT_CODES.PROCESSOR_CLEARING, credit: params.feeAmount! },
      ],
    });
  }

  await refreshInvoiceTotals(tx, invoice.id);
  await enqueueOutbox(tx, params.organizationId, OUTBOX_EVENTS.PAYMENT_RECEIVED, {
    paymentId: payment.id,
    invoiceId: invoice.id,
    customerId: params.customerId,
    amount: params.amount,
  });

  return payment;
}

/** Take a deposit before work starts. A deposit is a liability, not a sale. */
export async function recordDeposit(
  tx: Tx,
  params: {
    organizationId: string;
    customerId: string;
    amount: number;
    method: PaymentMethod;
    note?: string;
    actorId?: string | null;
  },
) {
  const deposit = await tx.customerDeposit.create({
    data: {
      organizationId: params.organizationId,
      customerId: params.customerId,
      amount: params.amount,
      note: params.note,
    },
  });

  await postJournalEntry(tx, {
    organizationId: params.organizationId,
    memo: `Customer deposit`,
    sourceType: "deposit",
    sourceId: deposit.id,
    postedById: params.actorId,
    lines: [
      { account: clearingAccountFor(params.method), debit: params.amount },
      { account: ACCOUNT_CODES.CUSTOMER_DEPOSITS, credit: params.amount },
    ],
  });

  return deposit;
}

/** Apply a held deposit to an issued invoice: liability down, receivable down. */
export async function applyDeposit(
  tx: Tx,
  params: {
    organizationId: string;
    depositId: string;
    invoiceId: string;
    amount: number;
    actorId?: string | null;
  },
) {
  const deposit = await tx.customerDeposit.findFirst({
    where: { id: params.depositId, organizationId: params.organizationId },
  });
  if (!deposit) throw ApiError.notFound("Deposit not found.");

  const invoice = await tx.invoice.findFirst({
    where: { id: params.invoiceId, organizationId: params.organizationId },
  });
  if (!invoice) throw ApiError.notFound("Invoice not found.");
  if (invoice.status === "DRAFT") {
    throw ApiError.unprocessable("Issue the invoice before applying a deposit.");
  }

  const available = deposit.amount - deposit.amountApplied;
  const amount = Math.min(params.amount, available, invoiceBalance(invoice));
  if (amount <= 0) {
    throw ApiError.unprocessable("Nothing left to apply from that deposit.");
  }

  await tx.depositApplication.create({
    data: { depositId: deposit.id, invoiceId: invoice.id, amount },
  });
  await tx.customerDeposit.update({
    where: { id: deposit.id },
    data: { amountApplied: { increment: amount } },
  });

  await postJournalEntry(tx, {
    organizationId: params.organizationId,
    memo: `Apply deposit to ${invoice.number}`,
    sourceType: "deposit_application",
    sourceId: deposit.id,
    postedById: params.actorId,
    lines: [
      { account: ACCOUNT_CODES.CUSTOMER_DEPOSITS, debit: amount },
      { account: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, credit: amount },
    ],
  });

  await refreshInvoiceTotals(tx, invoice.id);
  return { amount };
}

/**
 * A credit note reduces revenue, tax and receivable. It does NOT move money.
 * Posting both a credit note and a refund as revenue reductions would double
 * count (build guide / 08).
 */
export async function issueCreditNote(
  tx: Tx,
  params: {
    organizationId: string;
    invoiceId: string;
    amount: number;
    taxAmount: number;
    reason: string;
    actorId?: string | null;
  },
) {
  const invoice = await tx.invoice.findFirst({
    where: { id: params.invoiceId, organizationId: params.organizationId },
  });
  if (!invoice) throw ApiError.notFound("Invoice not found.");
  if (invoice.status === "DRAFT") {
    throw ApiError.unprocessable("A draft invoice is edited, not credited.");
  }

  const creditable = invoice.total - invoice.amountCredited;
  if (params.amount + params.taxAmount > creditable) {
    throw ApiError.unprocessable(
      "A credit note cannot exceed what is left on the invoice.",
    );
  }

  const number = await nextNumber(tx, params.organizationId, "credit_note");
  const note = await tx.creditNote.create({
    data: {
      organizationId: params.organizationId,
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      number,
      amount: params.amount,
      taxAmount: params.taxAmount,
      reason: params.reason,
      issuedById: params.actorId ?? null,
    },
  });

  await postJournalEntry(tx, {
    organizationId: params.organizationId,
    memo: `Credit note ${number} against ${invoice.number}`,
    sourceType: "credit_note",
    sourceId: note.id,
    postedById: params.actorId,
    lines: [
      { account: ACCOUNT_CODES.SALES_DISCOUNTS, debit: params.amount },
      ...(params.taxAmount > 0
        ? [{ account: ACCOUNT_CODES.SALES_TAX_PAYABLE, debit: params.taxAmount }]
        : []),
      {
        account: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE,
        credit: params.amount + params.taxAmount,
      },
    ],
  });

  await tx.invoice.update({
    where: { id: invoice.id },
    data: { amountCredited: { increment: params.amount + params.taxAmount } },
  });
  await refreshInvoiceTotals(tx, invoice.id);
  return note;
}

/**
 * Money going back out through the original provider.
 *
 * A refund unwinds the cash movement: it does NOT reduce revenue. Where the
 * sale itself should shrink, a credit note does that separately. Posting both
 * as revenue reductions would double count (build guide / 08).
 *
 *   Dr Accounts receivable  (or Customer deposits, for an unused deposit)
 *     Cr Processor clearing / Cash drawer
 */
export async function postRefund(
  tx: Tx,
  params: {
    organizationId: string;
    refundId: string;
    paymentId: string;
    amount: number;
    method: PaymentMethod;
    /** "deposit" when returning money the customer never spent. */
    against?: "receivable" | "deposit";
    actorId?: string | null;
  },
) {
  const debitAccount =
    params.against === "deposit"
      ? ACCOUNT_CODES.CUSTOMER_DEPOSITS
      : ACCOUNT_CODES.ACCOUNTS_RECEIVABLE;

  await postJournalEntry(tx, {
    organizationId: params.organizationId,
    memo: `Refund`,
    sourceType: "refund",
    sourceId: params.refundId,
    postedById: params.actorId,
    lines: [
      { account: debitAccount, debit: params.amount },
      { account: clearingAccountFor(params.method), credit: params.amount },
    ],
  });

  const payment = await tx.payment.findUnique({
    where: { id: params.paymentId },
    include: { allocations: { orderBy: { createdAt: "asc" } } },
  });
  if (!payment) return;

  const refunded = payment.amountRefunded + params.amount;
  await tx.payment.update({
    where: { id: payment.id },
    data: {
      amountRefunded: refunded,
      status: refunded >= payment.amount ? "REFUNDED" : "PARTLY_REFUNDED",
    },
  });

  // Give the invoice its balance back. Without this the invoice would still
  // read PAID while the ledger shows the receivable outstanding again.
  let remaining = params.amount;
  for (const allocation of payment.allocations) {
    if (remaining <= 0) break;
    const reduceBy = Math.min(allocation.amount, remaining);
    remaining -= reduceBy;

    if (reduceBy === allocation.amount) {
      await tx.paymentAllocation.delete({ where: { id: allocation.id } });
    } else {
      await tx.paymentAllocation.update({
        where: { id: allocation.id },
        data: { amount: allocation.amount - reduceBy },
      });
    }
    await refreshInvoiceTotals(tx, allocation.invoiceId);
  }
}

export function invoiceBalance(invoice: {
  total: number;
  amountPaid: number;
  amountCredited: number;
}): number {
  return invoice.total - invoice.amountPaid - invoice.amountCredited;
}

/**
 * The one rule for "can money be taken against this invoice right now".
 * Every payment path (card, QR, cash, external card machine, quick sale) goes
 * through it, so a draft, void, credited or settled invoice cannot take money.
 */
export function assertPayable(invoice: {
  status: InvoiceStatus;
  total: number;
  amountPaid: number;
  amountCredited: number;
}): number {
  switch (invoice.status) {
    case "DRAFT":
      throw ApiError.unprocessable("Issue the invoice before taking payment.");
    case "VOID":
      throw ApiError.unprocessable("This invoice is void. It cannot take a payment.");
    case "CREDITED":
      throw ApiError.unprocessable("This invoice was fully credited. Nothing is owed on it.");
    default:
      break;
  }
  const balance = invoiceBalance(invoice);
  if (balance <= 0) throw ApiError.unprocessable("This invoice is already paid in full.");
  return balance;
}

/** Reject an amount above what is owed, in words a cashier can act on. */
export function assertWithinBalance(amount: number, balance: number) {
  if (amount > balance) {
    throw ApiError.unprocessable(
      `That is more than the ${formatCents(balance)} still owed. Enter ${formatCents(balance)} or less.`,
      { amount: `At most ${formatCents(balance)}.` },
    );
  }
}

/**
 * Lock the invoice row for the rest of the transaction. Two cashiers paying
 * the same invoice at the same moment then run one after the other, and the
 * second sees the first's payment when it checks the balance.
 */
export async function lockInvoice(tx: Tx, invoiceId: string, organizationId: string) {
  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId} FOR UPDATE`;
  const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, organizationId } });
  if (!invoice) throw ApiError.notFound("Invoice not found.");
  return invoice;
}

/**
 * Recompute amountPaid and status from the allocations and credits that exist.
 * Derived rather than incremented, so a reversal cannot leave a stale total.
 */
export async function refreshInvoiceTotals(tx: Tx, invoiceId: string) {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    include: { allocations: true, creditNotes: true, depositApplications: true },
  });
  if (!invoice) return null;

  const paid =
    invoice.allocations.reduce((sum, a) => sum + a.amount, 0) +
    invoice.depositApplications.reduce((sum, a) => sum + a.amount, 0);
  const credited = invoice.creditNotes.reduce(
    (sum, c) => sum + c.amount + c.taxAmount,
    0,
  );
  const outstanding = invoice.total - paid - credited;

  let status: InvoiceStatus = invoice.status;
  if (invoice.status !== "DRAFT" && invoice.status !== "VOID") {
    if (credited >= invoice.total && invoice.total > 0) status = "CREDITED";
    else if (outstanding <= 0) status = "PAID";
    else if (paid > 0) status = "PARTLY_PAID";
    else status = "ISSUED";
  }

  return tx.invoice.update({
    where: { id: invoiceId },
    data: {
      amountPaid: paid,
      amountCredited: credited,
      status,
      paidAt: status === "PAID" ? (invoice.paidAt ?? new Date()) : null,
    },
  });
}
