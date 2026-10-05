import type { Tx } from "./prisma.js";

/**
 * Transactional outbox. The event is written in the SAME transaction as the
 * business change, so a notification is never sent for a change that rolled
 * back, and a committed change never loses its notification
 * (build guide / 11).
 */
export async function enqueueOutbox(
  tx: Tx,
  organizationId: string,
  eventType: string,
  payload: Record<string, unknown>,
) {
  return tx.outboxEvent.create({
    data: { organizationId, eventType, payload: payload as object },
  });
}

export const OUTBOX_EVENTS = {
  ESTIMATE_SENT: "estimate.sent",
  ESTIMATE_APPROVED: "estimate.approved",
  ESTIMATE_DECLINED: "estimate.declined",
  INVOICE_ISSUED: "invoice.issued",
  PAYMENT_RECEIVED: "payment.received",
  PAYMENT_FAILED: "payment.failed",
  REFUND_SUCCEEDED: "refund.succeeded",
  JOB_READY: "job.ready",
  JOB_DELIVERED: "job.delivered",
  RECONCILIATION_EXCEPTION: "reconciliation.exception",
} as const;
