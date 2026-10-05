/**
 * One internal contract that every payment provider adapter implements. It is
 * deliberately NOT a copy of any provider's API (build guide / 09).
 *
 * Capability flags exist so the UI can hide what a provider genuinely cannot
 * do, and so the API can return an explicit UnsupportedCapability error rather
 * than failing in a confusing way.
 */

export type ProviderCapabilities = {
  onlineCheckout: boolean;
  terminal: boolean;
  partialRefunds: boolean;
  settlementFeed: boolean;
  methods: Array<"CARD_ONLINE" | "CARD_TERMINAL" | "QR_CODE" | "ACH">;
};

export type CreatePaymentInput = {
  organizationId: string;
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  method: "CARD_ONLINE" | "CARD_TERMINAL" | "QR_CODE" | "ACH";
  idempotencyKey: string;
  terminalId?: string;
  returnUrl?: string;
};

export type ProviderPaymentState = {
  externalId: string;
  status: "pending" | "succeeded" | "failed" | "cancelled" | "unknown";
  externalStatus: string;
  amount: number;
  feeAmount: number;
  checkoutUrl?: string;
  failureCode?: string;
  failureMessage?: string;
};

export type RefundInput = {
  organizationId: string;
  externalPaymentId: string;
  amount: number;
  idempotencyKey: string;
  reason: string;
};

export type ProviderRefundState = {
  externalId: string;
  status: "pending" | "succeeded" | "failed";
  amount: number;
};

export type VerifiedWebhook = {
  eventId: string;
  eventType: string;
  externalAccountId: string | null;
  signatureValid: boolean;
  payload: Record<string, unknown>;
};

export class UnsupportedCapabilityError extends Error {
  constructor(provider: string, capability: string) {
    super(`${provider} does not support ${capability} in this deployment.`);
    this.name = "UnsupportedCapabilityError";
  }
}

export interface PaymentProviderAdapter {
  readonly name: string;
  getCapabilities(): ProviderCapabilities;
  createPayment(input: CreatePaymentInput): Promise<ProviderPaymentState>;
  /** Authoritative server-side lookup. Used to resolve UNKNOWN attempts. */
  getPaymentStatus(externalId: string): Promise<ProviderPaymentState>;
  refundPayment(input: RefundInput): Promise<ProviderRefundState>;
  /**
   * Ask the processor to stop a payment that has not settled. Optional: a
   * provider without it leaves the attempt to expire on the processor side.
   */
  cancelPayment?(externalId: string): Promise<void>;
  /** Verify the signature against the RAW body, before any parsing. */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): VerifiedWebhook;
}
