import type {
  EstimateStatus,
  InvoiceStatus,
  PaymentAttemptStatus,
  RepairOrderStatus,
} from "@prisma/client";
import { ApiError } from "../middlewares/error.middleware.js";

/**
 * Four separate state machines (build guide / 04). They are deliberately not
 * merged: an invoice being paid says nothing about whether the car has left.
 */

const ESTIMATE_TRANSITIONS: Record<EstimateStatus, EstimateStatus[]> = {
  DRAFT: ["SENT", "SUPERSEDED"],
  SENT: ["APPROVED", "PARTLY_APPROVED", "DECLINED", "EXPIRED", "SUPERSEDED"],
  APPROVED: ["SUPERSEDED"],
  PARTLY_APPROVED: ["APPROVED", "SUPERSEDED"],
  DECLINED: ["SUPERSEDED"],
  EXPIRED: ["SUPERSEDED"],
  SUPERSEDED: [],
};

const REPAIR_ORDER_TRANSITIONS: Record<RepairOrderStatus, RepairOrderStatus[]> = {
  SCHEDULED: ["CHECKED_IN", "CANCELLED"],
  CHECKED_IN: ["DIAGNOSING", "AWAITING_APPROVAL", "IN_PROGRESS", "CANCELLED"],
  DIAGNOSING: ["AWAITING_APPROVAL", "AWAITING_PARTS", "IN_PROGRESS", "CANCELLED"],
  AWAITING_APPROVAL: ["IN_PROGRESS", "AWAITING_PARTS", "DIAGNOSING", "CANCELLED"],
  AWAITING_PARTS: ["IN_PROGRESS", "AWAITING_APPROVAL", "CANCELLED"],
  IN_PROGRESS: ["QUALITY_CHECK", "AWAITING_PARTS", "AWAITING_APPROVAL", "CANCELLED"],
  QUALITY_CHECK: ["READY", "IN_PROGRESS"],
  READY: ["DELIVERED", "IN_PROGRESS"],
  DELIVERED: [],
  CANCELLED: [],
};

const INVOICE_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  DRAFT: ["ISSUED", "VOID"],
  ISSUED: ["PARTLY_PAID", "PAID", "CREDITED", "VOID"],
  PARTLY_PAID: ["PAID", "CREDITED", "PARTLY_PAID"],
  PAID: ["CREDITED", "PARTLY_PAID"],
  CREDITED: [],
  VOID: [],
};

const ATTEMPT_TRANSITIONS: Record<PaymentAttemptStatus, PaymentAttemptStatus[]> = {
  CREATED: ["PENDING", "SUCCEEDED", "FAILED", "CANCELLED", "UNKNOWN"],
  PENDING: ["SUCCEEDED", "FAILED", "CANCELLED", "UNKNOWN"],
  // An unknown outcome can still resolve either way once the provider is
  // queried authoritatively. It never resolves by the browser saying so.
  UNKNOWN: ["SUCCEEDED", "FAILED", "CANCELLED"],
  SUCCEEDED: [],
  FAILED: [],
  // Cancelling asks the processor to stop, but a processor can settle before
  // the cancel lands. That money is real and must still be posted.
  CANCELLED: ["SUCCEEDED"],
};

function guard<S extends string>(
  table: Record<S, S[]>,
  label: string,
  from: S,
  to: S,
): void {
  if (from === to) return;
  const allowed = table[from] ?? [];
  if (!allowed.includes(to)) {
    throw ApiError.conflict(
      `A ${label} cannot move from ${from} to ${to}. Allowed: ${allowed.join(", ") || "none"}.`,
    );
  }
}

export const assertEstimateTransition = (from: EstimateStatus, to: EstimateStatus) =>
  guard(ESTIMATE_TRANSITIONS, "estimate", from, to);

export const assertRepairOrderTransition = (
  from: RepairOrderStatus,
  to: RepairOrderStatus,
) => guard(REPAIR_ORDER_TRANSITIONS, "repair order", from, to);

export const assertInvoiceTransition = (from: InvoiceStatus, to: InvoiceStatus) =>
  guard(INVOICE_TRANSITIONS, "invoice", from, to);

export const assertAttemptTransition = (
  from: PaymentAttemptStatus,
  to: PaymentAttemptStatus,
) => guard(ATTEMPT_TRANSITIONS, "payment attempt", from, to);

export const REPAIR_ORDER_LANES: RepairOrderStatus[] = [
  "SCHEDULED",
  "CHECKED_IN",
  "DIAGNOSING",
  "AWAITING_APPROVAL",
  "AWAITING_PARTS",
  "IN_PROGRESS",
  "QUALITY_CHECK",
  "READY",
];
