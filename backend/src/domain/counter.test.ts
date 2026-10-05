import { describe, expect, it } from "vitest";
import { assertPayable, assertWithinBalance } from "./invoicing.js";
import { isLowStock, normalizeSerial, parseSerials } from "./inventory.js";
import { assertAttemptTransition } from "./states.js";
import { RateLimiter } from "../lib/rateLimit.js";
import { dayBounds } from "../lib/time.js";

const invoice = (status: string, total = 10_000, amountPaid = 0, amountCredited = 0) =>
  ({ status, total, amountPaid, amountCredited }) as Parameters<typeof assertPayable>[0];

describe("assertPayable", () => {
  it("refuses a draft, void or credited invoice", () => {
    expect(() => assertPayable(invoice("DRAFT"))).toThrow(/Issue the invoice/);
    expect(() => assertPayable(invoice("VOID"))).toThrow(/void/);
    expect(() => assertPayable(invoice("CREDITED"))).toThrow(/credited/);
  });

  it("refuses an invoice with nothing left to pay", () => {
    expect(() => assertPayable(invoice("PAID", 10_000, 10_000))).toThrow(/paid in full/);
    expect(() => assertPayable(invoice("PARTLY_PAID", 10_000, 6_000, 4_000))).toThrow(/paid in full/);
  });

  it("returns the balance of an open invoice", () => {
    expect(assertPayable(invoice("ISSUED"))).toBe(10_000);
    expect(assertPayable(invoice("PARTLY_PAID", 10_000, 2_500))).toBe(7_500);
  });
});

describe("assertWithinBalance", () => {
  it("blocks an overpayment and names the limit in dollars", () => {
    expect(() => assertWithinBalance(10_001, 10_000)).toThrow(/\$100\.00/);
  });
  it("allows the exact balance and partial payments", () => {
    expect(() => assertWithinBalance(10_000, 10_000)).not.toThrow();
    expect(() => assertWithinBalance(1, 10_000)).not.toThrow();
  });
});

describe("payment attempt states", () => {
  it("lets a cancelled attempt that the processor later settled be posted", () => {
    expect(() => assertAttemptTransition("CANCELLED", "SUCCEEDED")).not.toThrow();
  });
  it("never reopens a failed or succeeded attempt", () => {
    expect(() => assertAttemptTransition("FAILED", "SUCCEEDED")).toThrow();
    expect(() => assertAttemptTransition("SUCCEEDED", "FAILED")).toThrow();
  });
});

describe("serial numbers", () => {
  it("normalises spacing and case so a DOT code matches however it was typed", () => {
    expect(normalizeSerial(" dot u2ll lmlr 5107 ")).toBe("DOTU2LLLMLR5107");
  });

  it("splits a scanned or pasted block and drops blanks and repeats", () => {
    expect(parseSerials("ab1\n\nAB1\ncd2, ef3;gh4\t")).toEqual(["AB1", "CD2", "EF3", "GH4"]);
    expect(parseSerials(["x 1", "X1", "y2"])).toEqual(["X1", "Y2"]);
  });

  it("rejects a value too long to be a serial", () => {
    expect(() => parseSerials("A".repeat(65))).toThrow(/too long/);
  });

  it("counts a product as low when stock is at or under its reorder point", () => {
    expect(isLowStock(4, 4)).toBe(true);
    expect(isLowStock(0, 2)).toBe(true);
    expect(isLowStock(5, 4)).toBe(false);
  });
});

describe("RateLimiter", () => {
  it("allows up to the limit in a window, then asks the caller to wait", () => {
    const limiter = new RateLimiter(2, 60_000);
    expect(limiter.hit("ip", 0)).toBe(0);
    expect(limiter.hit("ip", 1)).toBe(0);
    expect(limiter.hit("ip", 2)).toBeGreaterThan(0);
    expect(limiter.hit("other", 2)).toBe(0);
  });

  it("starts a fresh window once the old one expires", () => {
    const limiter = new RateLimiter(1, 1_000);
    limiter.hit("ip", 0);
    expect(limiter.hit("ip", 500)).toBeGreaterThan(0);
    expect(limiter.hit("ip", 1_001)).toBe(0);
  });
});

describe("dayBounds", () => {
  it("uses the shop's midnight, not the server's", () => {
    // 2026-07-15 02:30 UTC is still July 14 in New Orleans (CDT, UTC-5).
    const { start, end } = dayBounds("America/Chicago", new Date("2026-07-15T02:30:00Z"));
    expect(start.toISOString()).toBe("2026-07-14T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-15T05:00:00.000Z");
  });

  it("handles standard time", () => {
    const { start } = dayBounds("America/Chicago", new Date("2026-01-10T18:00:00Z"));
    expect(start.toISOString()).toBe("2026-01-10T06:00:00.000Z");
  });

  it("gives a 23-hour day when clocks spring forward", () => {
    // DST starts 2026-03-08 in the US.
    const { start, end } = dayBounds("America/Chicago", new Date("2026-03-08T18:00:00Z"));
    expect(start.toISOString()).toBe("2026-03-08T06:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-09T05:00:00.000Z");
  });
});
