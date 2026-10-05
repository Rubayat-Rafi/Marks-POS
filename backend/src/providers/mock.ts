import crypto from "node:crypto";
import { env } from "../env.js";
import type {
  CreatePaymentInput,
  PaymentProviderAdapter,
  ProviderCapabilities,
  ProviderPaymentState,
  ProviderRefundState,
  RefundInput,
  VerifiedWebhook,
} from "./types.js";

/**
 * A fully working in-memory processor for development, demos and tests.
 *
 * It behaves like a real provider in the ways that matter: payments start
 * PENDING and are only confirmed by a signed webhook or an authoritative
 * status lookup, it charges a fee, and it is idempotent on the key. This is
 * what lets the whole repair-to-payment flow be exercised before any real
 * provider contract exists.
 */

type MockPayment = {
  externalId: string;
  amount: number;
  feeAmount: number;
  status: "pending" | "succeeded" | "failed" | "cancelled";
  refunded: number;
  idempotencyKey: string;
  method: string;
};

const payments = new Map<string, MockPayment>();
const byIdempotencyKey = new Map<string, string>();
const refunds = new Map<string, ProviderRefundState>();

/** 2.9% + 30c, the usual card shape. Assumed, not a quoted rate. */
function mockFee(amount: number): number {
  return Math.round(amount * 0.029) + 30;
}

export class MockPaymentProvider implements PaymentProviderAdapter {
  readonly name = "mock";

  getCapabilities(): ProviderCapabilities {
    return {
      onlineCheckout: true,
      terminal: true,
      partialRefunds: true,
      settlementFeed: false,
      // QR_CODE reuses the online checkout link; the code just encodes it.
      methods: ["CARD_ONLINE", "CARD_TERMINAL", "QR_CODE"],
    };
  }

  async createPayment(input: CreatePaymentInput): Promise<ProviderPaymentState> {
    const existingId = byIdempotencyKey.get(input.idempotencyKey);
    if (existingId) {
      const existing = payments.get(existingId)!;
      return this.toState(existing);
    }

    // The id doubles as the customer's checkout link, so it is long enough
    // (128 bits) that it cannot be guessed.
    const externalId = `mock_pi_${crypto.randomBytes(16).toString("hex")}`;
    const payment: MockPayment = {
      externalId,
      amount: input.amount,
      feeAmount: mockFee(input.amount),
      status: "pending",
      refunded: 0,
      idempotencyKey: input.idempotencyKey,
      method: input.method,
    };
    payments.set(externalId, payment);
    byIdempotencyKey.set(input.idempotencyKey, externalId);

    return {
      ...this.toState(payment),
      checkoutUrl: `${env.publicWebUrl}/pay/${externalId}`,
    };
  }

  async getPaymentStatus(externalId: string): Promise<ProviderPaymentState> {
    const payment = payments.get(externalId);
    if (!payment) {
      return {
        externalId,
        status: "unknown",
        externalStatus: "not_found",
        amount: 0,
        feeAmount: 0,
      };
    }
    return this.toState(payment);
  }

  async refundPayment(input: RefundInput): Promise<ProviderRefundState> {
    const existing = refunds.get(input.idempotencyKey);
    if (existing) return existing;

    const payment = payments.get(input.externalPaymentId);
    if (!payment) throw new Error(`Unknown payment ${input.externalPaymentId}`);
    if (payment.status !== "succeeded") {
      throw new Error("Only a settled payment can be refunded.");
    }
    if (payment.refunded + input.amount > payment.amount) {
      throw new Error("Refund exceeds the amount captured.");
    }

    payment.refunded += input.amount;
    const state: ProviderRefundState = {
      externalId: `mock_re_${crypto.randomBytes(9).toString("hex")}`,
      status: "succeeded",
      amount: input.amount,
    };
    refunds.set(input.idempotencyKey, state);
    return state;
  }

  async cancelPayment(externalId: string): Promise<void> {
    const payment = payments.get(externalId);
    if (payment && payment.status === "pending") payment.status = "cancelled";
  }

  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): VerifiedWebhook {
    const signature = String(headers["x-mock-signature"] ?? "");
    const expected = crypto
      .createHmac("sha256", env.mockWebhookSecret)
      .update(rawBody)
      .digest("hex");

    // Constant-time compare on equal-length buffers only.
    const valid =
      signature.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

    const payload = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    return {
      eventId: String(payload.id ?? ""),
      eventType: String(payload.type ?? ""),
      externalAccountId: (payload.account as string | undefined) ?? "mock_acct_demo",
      signatureValid: valid,
      payload,
    };
  }

  // -- test and demo helpers, not part of the adapter contract --------------

  /** Simulate the provider settling a payment, as a webhook would. */
  settle(externalId: string): MockPayment | undefined {
    const payment = payments.get(externalId);
    if (payment && payment.status === "pending") payment.status = "succeeded";
    return payment;
  }

  fail(externalId: string): MockPayment | undefined {
    const payment = payments.get(externalId);
    if (payment && payment.status === "pending") payment.status = "failed";
    return payment;
  }

  /** Sign a payload the way this provider would, for the demo webhook sender. */
  static sign(body: string): string {
    return crypto.createHmac("sha256", env.mockWebhookSecret).update(body).digest("hex");
  }

  private toState(p: MockPayment): ProviderPaymentState {
    return {
      externalId: p.externalId,
      status: p.status,
      externalStatus: p.status,
      amount: p.amount,
      feeAmount: p.status === "succeeded" ? p.feeAmount : 0,
      failureCode: p.status === "failed" ? "card_declined" : undefined,
      failureMessage: p.status === "failed" ? "The card was declined." : undefined,
    };
  }
}

export const mockProvider = new MockPaymentProvider();
