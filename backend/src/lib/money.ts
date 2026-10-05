/**
 * Money helpers. Every amount in this codebase is an integer number of minor
 * units (US cents). Floating point never touches a monetary value.
 */

export const CENTS = 100;

/** Round half away from zero, which is what a receipt shows. */
export function roundCents(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Parse "129.95" or 129.95 into 12995. Rejects anything unparseable. */
export function toCents(input: string | number): number {
  const n = typeof input === "string" ? Number(input) : input;
  if (!Number.isFinite(n)) throw new Error(`Not a valid amount: ${String(input)}`);
  return roundCents(n * CENTS);
}

/** 12995 -> "129.95". Display only; never feed this back into arithmetic. */
export function formatCents(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    cents / CENTS,
  );
}

/**
 * Apply a basis-point rate to an amount. 8.25% is 825 bps.
 * Tax is computed per line then summed, so the sum matches what a customer can
 * check line by line.
 */
export function applyBps(amountCents: number, bps: number): number {
  return roundCents((amountCents * bps) / 10_000);
}

/** Quantity x unit price, with quantity given to three decimals. */
export function extendLine(quantity: number, unitPriceCents: number): number {
  return roundCents(quantity * unitPriceCents);
}

/** Decimal columns arrive from Prisma as Decimal objects. */
export function decimalToNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  return Number(value.toString());
}
