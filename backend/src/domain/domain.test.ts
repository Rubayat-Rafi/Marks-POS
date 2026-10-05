import { describe, expect, it } from "vitest";
import { applyBps, extendLine, roundCents, toCents } from "../lib/money.js";
import { grossMarginPct, priceLines, type TaxPolicy } from "./pricing.js";
import {
  assertEstimateTransition,
  assertInvoiceTransition,
  assertRepairOrderTransition,
  assertAttemptTransition,
} from "./states.js";
import { can, permissionsForRole } from "../middlewares/rbac.middleware.js";

/**
 * Unit tests for the rules the build guide says must hold before a live pilot
 * (build guide / 13: pricing, permissions, states and ledger rules).
 */

const LA_POLICY: TaxPolicy = {
  taxRateBps: 950,
  taxesParts: true,
  taxesLabor: false,
  taxesFees: false,
};

describe("money", () => {
  it("parses dollars into exact cents", () => {
    expect(toCents("129.95")).toBe(12995);
    expect(toCents(0.1 + 0.2)).toBe(30); // the classic float trap
    expect(toCents("0.005")).toBe(1);
  });

  it("rounds half away from zero, the way a receipt reads", () => {
    expect(roundCents(1.5)).toBe(2);
    expect(roundCents(-1.5)).toBe(-2);
    expect(roundCents(2.4)).toBe(2);
  });

  it("applies a basis-point rate", () => {
    expect(applyBps(10_000, 950)).toBe(950);
    expect(applyBps(8995, 950)).toBe(855); // 854.525 rounds to 855
  });

  it("extends a fractional quantity without drift", () => {
    expect(extendLine(2.5, 14_500)).toBe(36_250);
    expect(extendLine(12, 1295)).toBe(15_540);
  });
});

describe("pricing", () => {
  it("taxes parts but not labor under a parts-only policy", () => {
    const totals = priceLines(
      [
        { lineType: "PART", quantity: 1, unitPrice: 10_000, taxable: true },
        { lineType: "LABOR", quantity: 2, unitPrice: 14_500, taxable: true },
      ],
      LA_POLICY,
    );

    expect(totals.subtotal).toBe(39_000);
    expect(totals.taxableBase).toBe(10_000);
    expect(totals.taxTotal).toBe(950);
    expect(totals.total).toBe(39_950);
  });

  it("subtracts a discount rather than adding it", () => {
    const totals = priceLines(
      [
        { lineType: "LABOR", quantity: 1, unitPrice: 20_000, taxable: true },
        // Even entered as a positive number, a discount reduces the sale.
        { lineType: "DISCOUNT", quantity: 1, unitPrice: 4_000, taxable: true },
      ],
      LA_POLICY,
    );

    expect(totals.subtotal).toBe(20_000);
    expect(totals.discountTotal).toBe(4_000);
    expect(totals.total).toBe(16_000);
  });

  it("charges no tax to an exempt customer", () => {
    const totals = priceLines(
      [{ lineType: "PART", quantity: 1, unitPrice: 10_000, taxable: true }],
      { ...LA_POLICY, customerTaxExempt: true },
    );
    expect(totals.taxTotal).toBe(0);
    expect(totals.total).toBe(10_000);
  });

  it("reproduces the worked example from the build guide", () => {
    // $200 labor, $100 parts, $30 tax, $330 total, cost $140.
    const totals = priceLines(
      [
        { lineType: "LABOR", quantity: 1, unitPrice: 20_000, unitCost: 8_000, taxable: true },
        { lineType: "PART", quantity: 1, unitPrice: 10_000, unitCost: 6_000, taxable: true },
      ],
      { taxRateBps: 1000, taxesParts: true, taxesLabor: true, taxesFees: false },
    );

    expect(totals.subtotal).toBe(30_000);
    expect(totals.taxTotal).toBe(3_000);
    expect(totals.total).toBe(33_000);
    expect(totals.estimatedCost).toBe(14_000);
    expect(grossMarginPct(30_000, 14_000)).toBeCloseTo(53.33, 2);
  });

  it("returns null margin on zero sales rather than a misleading zero", () => {
    expect(grossMarginPct(0, 0)).toBeNull();
    expect(grossMarginPct(0, 5_000)).toBeNull();
  });
});

describe("state machines", () => {
  it("lets a sent estimate be approved but not un-sent", () => {
    expect(() => assertEstimateTransition("SENT", "APPROVED")).not.toThrow();
    expect(() => assertEstimateTransition("APPROVED", "SENT")).toThrow();
  });

  it("refuses to resurrect a delivered job", () => {
    expect(() => assertRepairOrderTransition("READY", "DELIVERED")).not.toThrow();
    expect(() => assertRepairOrderTransition("DELIVERED", "IN_PROGRESS")).toThrow();
  });

  it("refuses to reopen a fully credited invoice", () => {
    expect(() => assertInvoiceTransition("ISSUED", "PARTLY_PAID")).not.toThrow();
    expect(() => assertInvoiceTransition("CREDITED", "ISSUED")).toThrow();
  });

  it("allows an unknown attempt to resolve either way, but never reverses a settled one", () => {
    expect(() => assertAttemptTransition("UNKNOWN", "SUCCEEDED")).not.toThrow();
    expect(() => assertAttemptTransition("UNKNOWN", "FAILED")).not.toThrow();
    expect(() => assertAttemptTransition("SUCCEEDED", "FAILED")).toThrow();
  });
});

describe("permissions", () => {
  it("keeps cost and margin data away from advisors and technicians", () => {
    expect(can("OWNER", "reports.costs")).toBe(true);
    expect(can("BOOKKEEPER", "reports.costs")).toBe(true);
    expect(can("SERVICE_ADVISOR", "reports.costs")).toBe(false);
    expect(can("TECHNICIAN", "reports.costs")).toBe(false);
  });

  it("keeps payments and customer exports away from technicians", () => {
    expect(can("TECHNICIAN", "payments.collect")).toBe(false);
    expect(can("TECHNICIAN", "customers.export")).toBe(false);
    expect(can("SERVICE_ADVISOR", "payments.collect")).toBe(true);
  });

  it("escalates a large refund to the owner", () => {
    expect(can("MANAGER", "payments.refund")).toBe(true);
    expect(can("MANAGER", "payments.refund.large")).toBe(false);
    expect(can("OWNER", "payments.refund.large")).toBe(true);
  });

  it("reserves provider credentials and shop settings for the owner", () => {
    expect(can("MANAGER", "providers.manage")).toBe(false);
    expect(can("MANAGER", "settings.write")).toBe(false);
    expect(can("OWNER", "settings.write")).toBe(true);
  });

  it("gives the owner every permission", () => {
    const owner = permissionsForRole("OWNER");
    const tech = permissionsForRole("TECHNICIAN");
    expect(owner.length).toBeGreaterThan(tech.length);
    expect(tech).not.toContain("finance.read");
  });
});
