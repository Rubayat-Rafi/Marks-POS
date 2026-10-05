import { env } from "../env.js";
import { ApiError } from "../middlewares/error.middleware.js";
import { mockProvider } from "./mock.js";
import type { PaymentProviderAdapter } from "./types.js";

/**
 * Only providers that are actually implemented appear here.
 *
 * Build guide / 01: "Never show an unimplemented provider as available."
 * Adding Stripe means writing a `StripeAdapter` against the real SDK and
 * registering it below, not adding a string to a dropdown.
 */
const REGISTRY: Record<string, PaymentProviderAdapter> = {
  // The mock moves no real money. In production it is only registered when
  // ALLOW_DEMO_PAYMENTS is set, so a live shop never shows a card or QR
  // button that would record a fake payment. Cash, check and the external
  // card machine are recorded by hand and never need a provider.
  ...(env.demoPayments ? { mock: mockProvider } : {}),
};

export function getPaymentProvider(name: string): PaymentProviderAdapter {
  const adapter = REGISTRY[name];
  if (!adapter) {
    throw ApiError.unprocessable(
      `Payment provider "${name}" is not available in this build. Available: ${Object.keys(REGISTRY).join(", ") || "none"}. Cash, check and the external card machine still work.`,
    );
  }
  return adapter;
}

export function implementedProviders(): Array<{
  name: string;
  capabilities: ReturnType<PaymentProviderAdapter["getCapabilities"]>;
}> {
  return Object.values(REGISTRY).map((p) => ({
    name: p.name,
    capabilities: p.getCapabilities(),
  }));
}
