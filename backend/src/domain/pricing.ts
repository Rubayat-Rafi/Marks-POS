import { applyBps, extendLine, roundCents } from "../lib/money.js";

/**
 * All pricing happens on the server. The browser sends quantities and unit
 * prices; it never sends a total (build guide / 04 step 2).
 */

export type PricingLineInput = {
  lineType: "PART" | "LABOR" | "FEE" | "SUBLET" | "DISCOUNT";
  quantity: number;
  unitPrice: number;
  unitCost?: number;
  taxable: boolean;
};

export type PricedLine = PricingLineInput & {
  lineTotal: number;
  taxAmount: number;
  taxRateBps: number;
};

export type TaxPolicy = {
  taxRateBps: number;
  taxesParts: boolean;
  taxesLabor: boolean;
  taxesFees: boolean;
  customerTaxExempt?: boolean;
};

/** Whether a line type is taxable under this shop's configuration. */
export function lineTypeTaxable(lineType: PricingLineInput["lineType"], policy: TaxPolicy) {
  if (policy.customerTaxExempt) return false;
  switch (lineType) {
    case "PART":
      return policy.taxesParts;
    case "LABOR":
      return policy.taxesLabor;
    case "FEE":
    case "SUBLET":
      return policy.taxesFees;
    case "DISCOUNT":
      return false;
    default:
      return false;
  }
}

export type PricingTotals = {
  lines: PricedLine[];
  subtotal: number;
  discountTotal: number;
  taxableBase: number;
  taxTotal: number;
  total: number;
  /** Direct cost implied by the lines as priced. Estimated, not actual. */
  estimatedCost: number;
};

/**
 * Net job sales = parts + labor + approved fees - discounts, excluding sales
 * tax (build guide / 07). Discount lines carry a positive unitPrice and are
 * subtracted here, so a discount can never accidentally add to the sale.
 */
export function priceLines(
  input: PricingLineInput[],
  policy: TaxPolicy,
): PricingTotals {
  const lines: PricedLine[] = [];
  let subtotal = 0;
  let discountTotal = 0;
  let taxableBase = 0;
  let taxTotal = 0;
  let estimatedCost = 0;

  for (const raw of input) {
    const gross = extendLine(raw.quantity, raw.unitPrice);
    const isDiscount = raw.lineType === "DISCOUNT";
    const lineTotal = isDiscount ? -Math.abs(gross) : gross;

    const taxable = raw.taxable && lineTypeTaxable(raw.lineType, policy);
    const taxRateBps = taxable ? policy.taxRateBps : 0;
    const taxAmount = taxable ? applyBps(lineTotal, policy.taxRateBps) : 0;

    if (isDiscount) {
      discountTotal += Math.abs(lineTotal);
    } else {
      subtotal += lineTotal;
    }
    if (taxable) taxableBase += lineTotal;
    taxTotal += taxAmount;
    estimatedCost += extendLine(raw.quantity, raw.unitCost ?? 0);

    lines.push({ ...raw, lineTotal, taxAmount, taxRateBps });
  }

  const net = subtotal - discountTotal;
  return {
    lines,
    subtotal,
    discountTotal,
    taxableBase,
    taxTotal,
    total: net + taxTotal,
    estimatedCost: roundCents(estimatedCost),
  };
}

/**
 * Gross margin as a percentage. Returns null where sales are zero, so the UI
 * can print N/A rather than a misleading 0% (build guide / 07).
 */
export function grossMarginPct(netSales: number, directCost: number): number | null {
  if (netSales === 0) return null;
  return ((netSales - directCost) / netSales) * 100;
}
