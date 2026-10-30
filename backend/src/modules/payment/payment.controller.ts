import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../db.js";
import { env } from "../../env.js";
import { ApiError } from "../../middlewares/error.middleware.js";
import { queryDate } from "../../utils/query.js";
import { auth, tenantScope } from "../../middlewares/auth.middleware.js";
import { assertPermission, MANAGER_REFUND_LIMIT_CENTS } from "../../middlewares/rbac.middleware.js";
import { auditContext, recordAudit } from "../../lib/audit.js";
import { enqueueOutbox, OUTBOX_EVENTS } from "../../lib/outbox.js";
import { formatCents } from "../../lib/money.js";
import { getPaymentProvider, implementedProviders } from "../../providers/registry.js";
import {
  applyDeposit,
  assertPayable,
  assertWithinBalance,
  invoiceBalance,
  lockInvoice,
  postRefund,
  recordDeposit,
  recordPayment,
} from "../../domain/invoicing.js";
import { MANUAL_METHODS, OPEN_ATTEMPT_STATUSES, resolveAttempt } from "../../domain/payments.js";
import { deletePaymentTx } from "../../domain/deletion.js";

export const idempotencyKey = z
  .string()
  .min(8, "An idempotency key is required.")
  .max(100)
  .regex(/^[\w-]+$/, "Use letters, digits and dashes only.");

export async function assertNoOpenAttempt(invoiceId: string, organizationId: string) {
  const open = await db.paymentAttempt.findFirst({
    where: { invoiceId, organizationId, status: { in: OPEN_ATTEMPT_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
  if (open) {
    throw new ApiError(
      409,
      "attempt_open",
      `A ${open.method === "QR_CODE" ? "QR" : "card"} payment of ${formatCents(open.amount)} is still waiting on this invoice. Check it, or tap "Start new payment" to cancel it first.`,
      { attemptId: open.id },
    );
  }
}

export async function findManualReplay(
  organizationId: string,
  body: { idempotencyKey: string; invoiceId: string; amount: number; method: string; tendered?: number },
) {
  const existing = await db.paymentAttempt.findUnique({
    where: { organizationId_idempotencyKey: { organizationId, idempotencyKey: body.idempotencyKey } },
    include: { payment: true, invoice: true },
  });
  if (!existing) return null;
  if (
    !existing.payment ||
    existing.invoiceId !== body.invoiceId ||
    existing.amount !== body.amount ||
    existing.method !== body.method
  ) {
    throw ApiError.conflict(
      "That payment key was already used for a different payment. Tap \"Start new payment\" and try again.",
    );
  }
  return {
    payment: existing.payment,
    invoice: {
      id: existing.invoice.id,
      number: existing.invoice.number,
      status: existing.invoice.status,
      balance: invoiceBalance(existing.invoice),
    },
    change: body.tendered ? body.tendered - body.amount : 0,
    duplicate: true,
  };
}

export async function getProviders(req: Request, res: Response) {
  const org = await db.organization.findUniqueOrThrow({
    where: { id: auth(req).organizationId },
  });
  const available = implementedProviders();
  res.json({
    selected: org.paymentProvider,
    available,
    selectedIsImplemented: available.some((p) => p.name === org.paymentProvider),
    demoTools: env.demoPayments,
    manualMethods: MANUAL_METHODS,
  });
}

export async function createAttempt(req: Request, res: Response) {
  const ctx = auth(req);
  const body = z
    .object({
      invoiceId: z.string().uuid(),
      amount: z.number().int().positive("Enter an amount above zero."),
      method: z.enum(["CARD_ONLINE", "CARD_TERMINAL", "QR_CODE", "ACH"]),
      idempotencyKey,
      terminalId: z.string().max(100).optional(),
    })
    .parse(req.body);

  const existing = await db.paymentAttempt.findUnique({
    where: {
      organizationId_idempotencyKey: {
        organizationId: ctx.organizationId,
        idempotencyKey: body.idempotencyKey,
      },
    },
  });
  if (existing) {
    if (
      existing.amount !== body.amount ||
      existing.invoiceId !== body.invoiceId ||
      existing.method !== body.method
    ) {
      throw ApiError.conflict(
        "That payment key was already used for a different payment. Tap \"Start new payment\" and try again.",
      );
    }
    res.json(existing);
    return;
  }

  const invoice = await db.invoice.findFirst({
    where: { id: body.invoiceId, ...tenantScope(req) },
  });
  if (!invoice) throw ApiError.notFound("Invoice not found.");
  const balance = assertPayable(invoice);
  assertWithinBalance(body.amount, balance);
  await assertNoOpenAttempt(invoice.id, ctx.organizationId);

  const org = await db.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
  });
  const provider = getPaymentProvider(org.paymentProvider);
  const capabilities = provider.getCapabilities();
  if (!capabilities.methods.includes(body.method)) {
    throw ApiError.unprocessable(
      `${provider.name} does not support ${body.method} in this deployment.`,
    );
  }

  const attempt = await db.paymentAttempt.create({
    data: {
      organizationId: ctx.organizationId,
      invoiceId: invoice.id,
      provider: provider.name,
      method: body.method,
      amount: body.amount,
      currency: invoice.currency,
      idempotencyKey: body.idempotencyKey,
      status: "CREATED",
    },
  });

  try {
    const state = await provider.createPayment({
      organizationId: ctx.organizationId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      amount: body.amount,
      currency: invoice.currency,
      method: body.method,
      idempotencyKey: body.idempotencyKey,
      terminalId: body.terminalId,
    });

    const updated = await db.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "PENDING",
        externalId: state.externalId,
        externalStatus: state.externalStatus,
        checkoutUrl: state.checkoutUrl,
      },
    });

    await recordAudit(db, {
      organizationId: ctx.organizationId,
      ...auditContext(req),
      action: "payment.attempt_started",
      resourceType: "payment_attempt",
      resourceId: attempt.id,
      metadata: { invoiceId: invoice.id, amount: body.amount, provider: provider.name },
    });

    res.status(201).json(updated);
  } catch (error) {
    const updated = await db.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "UNKNOWN",
        failureMessage: error instanceof Error ? error.message : String(error),
      },
    });
    await db.reconciliationItem.create({
      data: {
        organizationId: ctx.organizationId,
        kind: "unknown_attempt",
        reference: attempt.id,
        amount: body.amount,
        detail:
          "The processor did not answer. The outcome is unknown; resolve it before retrying.",
      },
    });
    res.status(202).json({
      ...updated,
      message:
        "We could not confirm the payment with the processor. Do not retry on another processor until this attempt is resolved.",
    });
  }
}

export async function resolveAttemptHandler(req: Request, res: Response) {
  const ctx = auth(req);
  const result = await resolveAttempt({
    attemptId: req.params.id,
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
  });
  res.json({ ...result.attempt, message: "message" in result ? result.message : undefined });
}

export async function cancelAttempt(req: Request, res: Response) {
  const ctx = auth(req);
  const attempt = await db.paymentAttempt.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!attempt) throw ApiError.notFound("Payment attempt not found.");
  if (!OPEN_ATTEMPT_STATUSES.includes(attempt.status)) {
    res.json(attempt);
    return;
  }
  if (attempt.status === "UNKNOWN") assertPermission(ctx.role, "payments.refund");

  if (attempt.externalId) {
    try {
      const checked = await resolveAttempt({
        attemptId: attempt.id,
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
      });
      if (checked.settled) {
        res.json({
          ...checked.attempt,
          message:
            checked.attempt.status === "SUCCEEDED"
              ? "The processor had already approved this payment, so it was recorded instead of cancelled."
              : undefined,
        });
        return;
      }
    } catch {
      // Processor unreachable or not registered
    }
    try {
      await getPaymentProvider(attempt.provider).cancelPayment?.(attempt.externalId);
    } catch {
      // Best effort
    }
  }

  const cancelled = await db.$transaction(async (tx) => {
    await tx.paymentAttempt.updateMany({
      where: { id: attempt.id, status: { in: OPEN_ATTEMPT_STATUSES } },
      data: { status: "CANCELLED", resolvedAt: new Date() },
    });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      ...auditContext(req),
      action: "payment.attempt_cancelled",
      resourceType: "payment_attempt",
      resourceId: attempt.id,
      metadata: { previousStatus: attempt.status, amount: attempt.amount },
    });
    return tx.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
  });
  res.json(cancelled);
}

export async function recordManualPayment(req: Request, res: Response) {
  const ctx = auth(req);
  const body = z
    .object({
      invoiceId: z.string().uuid(),
      amount: z.number().int().positive("Enter an amount above zero."),
      method: z.enum(MANUAL_METHODS),
      reference: z.string().trim().max(60).optional(),
      tendered: z.number().int().positive().optional(),
      cancelOpenAttempt: z.boolean().optional(),
      idempotencyKey,
    })
    .parse(req.body);

  if (body.tendered !== undefined) {
    if (body.method !== "CASH") {
      throw ApiError.badRequest("Cash tendered only applies to cash payments.");
    }
    if (body.tendered < body.amount) {
      throw ApiError.unprocessable("Cash received is less than the amount being paid.", {
        tendered: "Must be at least the amount.",
      });
    }
  }

  const replay = await findManualReplay(ctx.organizationId, body);
  if (replay) {
    res.json(replay);
    return;
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const invoice = await lockInvoice(tx, body.invoiceId, ctx.organizationId);
      const balance = assertPayable(invoice);
      assertWithinBalance(body.amount, balance);

      const open = await tx.paymentAttempt.findFirst({
        where: { invoiceId: invoice.id, organizationId: ctx.organizationId, status: { in: OPEN_ATTEMPT_STATUSES } },
      });
      if (open) {
        if (body.cancelOpenAttempt) {
          await tx.paymentAttempt.update({
            where: { id: open.id },
            data: { status: "CANCELLED", resolvedAt: new Date() },
          });
        } else {
          throw new ApiError(
            409,
            "attempt_open",
            `A ${open.method === "QR_CODE" ? "QR" : "card"} payment of ${formatCents(open.amount)} is still waiting on this invoice. Tap "Start new payment" to cancel it before recording ${body.method === "CASH" ? "cash" : "this payment"}.`,
            { attemptId: open.id },
          );
        }
      }

      const attempt = await tx.paymentAttempt.create({
        data: {
          organizationId: ctx.organizationId,
          invoiceId: invoice.id,
          provider: "manual",
          method: body.method,
          amount: body.amount,
          currency: invoice.currency,
          idempotencyKey: body.idempotencyKey,
          status: "SUCCEEDED",
          externalId: `manual_${body.idempotencyKey}`,
          resolvedAt: new Date(),
        },
      });

      const payment = await recordPayment(tx, {
        organizationId: ctx.organizationId,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        amount: body.amount,
        method: body.method,
        provider: "manual",
        externalId: attempt.externalId,
        attemptId: attempt.id,
        actorId: ctx.userId,
        reference: body.reference || null,
        tenderedAmount: body.tendered ?? null,
      });

      await recordAudit(tx, {
        organizationId: ctx.organizationId,
        ...auditContext(req),
        action: "payment.recorded_manually",
        resourceType: "payment",
        resourceId: payment.id,
        metadata: { method: body.method, amount: body.amount, reference: body.reference },
      });

      const after = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      return {
        payment,
        invoice: { id: after.id, number: after.number, status: after.status, balance: invoiceBalance(after) },
        change: body.tendered ? body.tendered - body.amount : 0,
      };
    });
    res.status(201).json(result);
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      const winner = await findManualReplay(ctx.organizationId, body);
      if (winner) {
        res.json(winner);
        return;
      }
    }
    throw error;
  }
}

export async function createDeposit(req: Request, res: Response) {
  const ctx = auth(req);
  const body = z
    .object({
      customerId: z.string().uuid(),
      amount: z.number().int().positive(),
      method: z.enum(["CASH", "CHECK", "CARD_ONLINE", "CARD_TERMINAL", "QR_CODE", "CARD_EXTERNAL", "OTHER"]),
      note: z.string().max(500).optional(),
    })
    .parse(req.body);

  const customer = await db.customer.findFirst({
    where: { id: body.customerId, ...tenantScope(req) },
  });
  if (!customer) throw ApiError.notFound("Customer not found.");

  const deposit = await db.$transaction((tx) =>
    recordDeposit(tx, {
      organizationId: ctx.organizationId,
      customerId: body.customerId,
      amount: body.amount,
      method: body.method,
      note: body.note,
      actorId: ctx.userId,
    }),
  );
  res.status(201).json(deposit);
}

export async function applyDepositHandler(req: Request, res: Response) {
  const ctx = auth(req);
  const body = z
    .object({ invoiceId: z.string().uuid(), amount: z.number().int().positive() })
    .parse(req.body);

  const result = await db.$transaction(async (tx) => {
    const invoice = await lockInvoice(tx, body.invoiceId, ctx.organizationId);
    assertPayable(invoice);
    return applyDeposit(tx, {
      organizationId: ctx.organizationId,
      depositId: req.params.depositId,
      invoiceId: body.invoiceId,
      amount: body.amount,
      actorId: ctx.userId,
    });
  });
  res.json(result);
}

export async function refundPayment(req: Request, res: Response) {
  const ctx = auth(req);
  const body = z
    .object({
      amount: z.number().int().positive(),
      reason: z.string().min(3, "Give a reason for the refund.").max(500),
      idempotencyKey,
    })
    .parse(req.body);

  if (body.amount > MANAGER_REFUND_LIMIT_CENTS) {
    assertPermission(ctx.role, "payments.refund.large");
  }

  const existing = await db.refund.findUnique({
    where: {
      organizationId_idempotencyKey: {
        organizationId: ctx.organizationId,
        idempotencyKey: body.idempotencyKey,
      },
    },
  });
  if (existing) {
    res.json(existing);
    return;
  }

  const payment = await db.payment.findFirst({
    where: { id: req.params.paymentId, ...tenantScope(req) },
  });
  if (!payment) throw ApiError.notFound("Payment not found.");

  const refundable = payment.amount - payment.amountRefunded;
  if (body.amount > refundable) {
    throw ApiError.unprocessable(
      `Only ${formatCents(refundable)} of that payment can still be refunded.`,
    );
  }

  const refund = await db.refund.create({
    data: {
      organizationId: ctx.organizationId,
      paymentId: payment.id,
      amount: body.amount,
      reason: body.reason,
      provider: payment.provider,
      idempotencyKey: body.idempotencyKey,
      requestedById: ctx.userId,
    },
  });

  if (payment.provider === "manual") {
    const settled = await db.$transaction(async (tx) => {
      await postRefund(tx, {
        organizationId: ctx.organizationId,
        refundId: refund.id,
        paymentId: payment.id,
        amount: body.amount,
        method: payment.method,
        actorId: ctx.userId,
      });
      await recordAudit(tx, {
        organizationId: ctx.organizationId,
        ...auditContext(req),
        action: "payment.refunded",
        resourceType: "refund",
        resourceId: refund.id,
        reason: body.reason,
        metadata: { amount: body.amount, paymentId: payment.id },
      });
      return tx.refund.update({
        where: { id: refund.id },
        data: { status: "SUCCEEDED", resolvedAt: new Date() },
      });
    });
    res.status(201).json(settled);
    return;
  }

  const provider = getPaymentProvider(payment.provider);
  try {
    const state = await provider.refundPayment({
      organizationId: ctx.organizationId,
      externalPaymentId: payment.externalId!,
      amount: body.amount,
      idempotencyKey: body.idempotencyKey,
      reason: body.reason,
    });

    const settled = await db.$transaction(async (tx) => {
      if (state.status === "succeeded") {
        await postRefund(tx, {
          organizationId: ctx.organizationId,
          refundId: refund.id,
          paymentId: payment.id,
          amount: body.amount,
          method: payment.method,
          actorId: ctx.userId,
        });
        await enqueueOutbox(tx, ctx.organizationId, OUTBOX_EVENTS.REFUND_SUCCEEDED, {
          refundId: refund.id,
          amount: body.amount,
        });
      }
      await recordAudit(tx, {
        organizationId: ctx.organizationId,
        ...auditContext(req),
        action: "payment.refunded",
        resourceType: "refund",
        resourceId: refund.id,
        reason: body.reason,
        metadata: { amount: body.amount, paymentId: payment.id },
      });
      return tx.refund.update({
        where: { id: refund.id },
        data: {
          status: state.status === "succeeded" ? "SUCCEEDED" : "PENDING",
          externalId: state.externalId,
          resolvedAt: state.status === "succeeded" ? new Date() : null,
        },
      });
    });

    res.status(201).json(settled);
  } catch (error) {
    const failed = await db.refund.update({
      where: { id: refund.id },
      data: { status: "FAILED", resolvedAt: new Date() },
    });
    await db.reconciliationItem.create({
      data: {
        organizationId: ctx.organizationId,
        kind: "refund_failed",
        reference: refund.id,
        amount: body.amount,
        detail: error instanceof Error ? error.message : String(error),
      },
    });
    res.status(502).json({
      ...failed,
      error: {
        code: "refund_failed",
        message: "The processor rejected the refund. It is in the reconciliation queue.",
      },
    });
  }
}

export async function listPayments(req: Request, res: Response) {
  const from = queryDate(req.query.from, "from");
  const payments = await db.payment.findMany({
    where: { ...tenantScope(req), ...(from ? { receivedAt: { gte: from } } : {}) },
    orderBy: { receivedAt: "desc" },
    take: 200,
    include: {
      customer: { select: { firstName: true, lastName: true } },
      allocations: { include: { invoice: { select: { id: true, number: true } } } },
      refunds: true,
    },
  });
  res.json({ data: payments });
}

export async function simulatePayment(req: Request, res: Response) {
  if (!env.demoPayments) throw ApiError.notFound("Not available.");
  const { outcome } = z
    .object({ outcome: z.enum(["settle", "fail"]) })
    .parse(req.body);

  const attempt = await db.paymentAttempt.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!attempt) throw ApiError.notFound("Payment attempt not found.");
  if (attempt.provider !== "mock" || !attempt.externalId) {
    throw ApiError.unprocessable("Simulation is only available on the mock provider.");
  }

  const { mockProvider } = await import("../../providers/mock.js");
  if (outcome === "settle") mockProvider.settle(attempt.externalId);
  else mockProvider.fail(attempt.externalId);

  res.json({
    ok: true,
    message: "The processor state changed. Call /resolve to post the result.",
  });
}

export async function deletePayment(req: Request, res: Response) {
  const ctx = auth(req);
  const payment = await db.payment.findFirst({
    where: { id: req.params.paymentId, ...tenantScope(req) },
  });
  if (!payment) throw ApiError.notFound("Payment not found.");

  await db.$transaction(async (tx) => {
    await deletePaymentTx(tx, ctx.organizationId, payment.id);
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      ...auditContext(req),
      action: "payment.deleted",
      resourceType: "payment",
      resourceId: payment.id,
      metadata: { amount: payment.amount, method: payment.method },
    });
  });

  res.json({ success: true });
}
