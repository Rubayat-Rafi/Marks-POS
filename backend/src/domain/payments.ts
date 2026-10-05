import type { PaymentAttemptStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../middlewares/error.middleware.js";
import { enqueueOutbox, OUTBOX_EVENTS } from "../lib/outbox.js";
import { getPaymentProvider } from "../providers/registry.js";
import { assertAttemptTransition } from "./states.js";
import { recordPayment } from "./invoicing.js";

/** Payments typed in by staff: money that did not pass through a connected processor. */
export const MANUAL_METHODS = ["CASH", "CHECK", "CARD_EXTERNAL", "OTHER"] as const;

/** Attempts that have not reached a final answer from the processor. */
export const OPEN_ATTEMPT_STATUSES: PaymentAttemptStatus[] = ["CREATED", "PENDING", "UNKNOWN"];

/**
 * Ask the processor what happened to an attempt and post the result once.
 *
 * The browser, the customer's checkout page and a webhook can all trigger
 * this at the same moment. The status change is a compare-and-set on the
 * attempt row, so exactly one caller posts the money and the rest read the
 * result (build guide / 09).
 */
export async function resolveAttempt(params: {
  attemptId: string;
  organizationId: string;
  actorId?: string | null;
}) {
  const attempt = await prisma.paymentAttempt.findFirst({
    where: { id: params.attemptId, organizationId: params.organizationId },
    include: { invoice: true },
  });
  if (!attempt) throw ApiError.notFound("Payment attempt not found.");
  if (attempt.status === "SUCCEEDED" || attempt.status === "FAILED") {
    return { attempt, settled: true as const };
  }
  if (!attempt.externalId) {
    throw ApiError.unprocessable("This attempt never reached the processor.");
  }

  const provider = getPaymentProvider(attempt.provider);
  const state = await provider.getPaymentStatus(attempt.externalId);

  if (state.status === "pending" || state.status === "unknown" || state.status === "cancelled") {
    return {
      attempt: { ...attempt, externalStatus: state.externalStatus },
      settled: false as const,
      message:
        attempt.status === "CANCELLED"
          ? "This payment was cancelled."
          : "The processor has not settled this payment yet.",
    };
  }

  const nextStatus = state.status === "succeeded" ? "SUCCEEDED" : "FAILED";
  // A cancelled attempt that the processor later settled is still real money
  // and must be posted; a cancelled attempt that failed stays cancelled.
  if (attempt.status === "CANCELLED" && nextStatus === "FAILED") {
    return { attempt, settled: false as const, message: "This payment was cancelled." };
  }
  assertAttemptTransition(attempt.status, nextStatus);

  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.paymentAttempt.updateMany({
      where: {
        id: attempt.id,
        status: { in: nextStatus === "SUCCEEDED" ? [...OPEN_ATTEMPT_STATUSES, "CANCELLED"] : OPEN_ATTEMPT_STATUSES },
      },
      data: {
        status: nextStatus,
        externalStatus: state.externalStatus,
        failureCode: state.failureCode ?? null,
        failureMessage: state.failureMessage ?? null,
        resolvedAt: new Date(),
      },
    });
    // Someone else resolved it between our read and this write.
    if (claimed.count === 0) return null;

    if (nextStatus === "SUCCEEDED") {
      await recordPayment(tx, {
        organizationId: attempt.organizationId,
        invoiceId: attempt.invoiceId,
        customerId: attempt.invoice.customerId,
        amount: state.amount,
        feeAmount: state.feeAmount,
        method: attempt.method,
        provider: attempt.provider,
        externalId: state.externalId,
        attemptId: attempt.id,
        actorId: params.actorId ?? null,
      });
    } else {
      await enqueueOutbox(tx, attempt.organizationId, OUTBOX_EVENTS.PAYMENT_FAILED, {
        attemptId: attempt.id,
        invoiceId: attempt.invoiceId,
        failureCode: state.failureCode,
      });
    }
    return tx.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
  });

  const latest =
    result ?? (await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } }));
  return { attempt: latest, settled: latest.status === "SUCCEEDED" || latest.status === "FAILED" };
}