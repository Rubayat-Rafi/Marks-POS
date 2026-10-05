import type { InventoryKind } from "@prisma/client";
import type { Tx } from "../lib/prisma.js";
import { ApiError } from "../middlewares/error.middleware.js";
import { enqueueOutbox } from "../lib/outbox.js";

/**
 * Serialised stock for tires and mufflers.
 *
 * Every physical item is one row keyed by its serial number. "How many are on
 * the shelf" is always a count of IN_STOCK rows, never a stored number, so the
 * count cannot drift from the serial list.
 */

export const LOW_STOCK_EVENT = "inventory.low_stock";

/**
 * Normalise what was typed or scanned. Tire DOT codes are often written with
 * spaces ("DOT U2LL LMLR 5107"); stripping whitespace and upper-casing makes
 * the same tire match however it was keyed in.
 */
export function normalizeSerial(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/** Split a pasted or scanned block (one per line, or comma separated) into unique serials. */
export function parseSerials(input: string | string[]): string[] {
  const parts = Array.isArray(input) ? input : input.split(/[\n,;\t]+/);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of parts) {
    const serial = normalizeSerial(part);
    if (!serial) continue;
    if (serial.length > 64) {
      throw ApiError.unprocessable(`"${serial.slice(0, 20)}…" is too long for a serial number.`);
    }
    if (!seen.has(serial)) {
      seen.add(serial);
      result.push(serial);
    }
  }
  return result;
}

export function isLowStock(inStock: number, reorderPoint: number): boolean {
  return inStock <= reorderPoint;
}

/** In-stock counts for a set of products, as a map of productId to count. */
export async function inStockCounts(
  tx: Tx,
  organizationId: string,
  productIds?: string[],
): Promise<Map<string, number>> {
  const groups = await tx.inventoryUnit.groupBy({
    by: ["productId"],
    where: {
      organizationId,
      status: "IN_STOCK",
      ...(productIds ? { productId: { in: productIds } } : {}),
    },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.productId, g._count._all]));
}

/**
 * Mark serials as sold on an invoice line. The update only touches units that
 * are still IN_STOCK in this shop, and fails if any are not, so two counters
 * cannot sell the same tire.
 */
export async function sellUnits(
  tx: Tx,
  params: {
    organizationId: string;
    unitIds: string[];
    invoiceId: string;
    invoiceLineId: string;
  },
) {
  if (params.unitIds.length === 0) return;
  const updated = await tx.inventoryUnit.updateMany({
    where: {
      id: { in: params.unitIds },
      organizationId: params.organizationId,
      status: "IN_STOCK",
    },
    data: {
      status: "SOLD",
      soldAt: new Date(),
      invoiceId: params.invoiceId,
      invoiceLineId: params.invoiceLineId,
    },
  });
  if (updated.count !== params.unitIds.length) {
    throw ApiError.conflict(
      "One of those serial numbers is no longer in stock (it may have just been sold). Refresh and pick again.",
    );
  }
}

/**
 * After stock goes out, raise a reminder for any product that has just
 * reached its reorder point. Written to the outbox so a staff alert (text or
 * email to the owner) can be wired to it later without touching this code.
 */
export async function flagLowStock(
  tx: Tx,
  organizationId: string,
  productIds: string[],
): Promise<Array<{ id: string; name: string; inStock: number; reorderPoint: number }>> {
  if (productIds.length === 0) return [];
  const [products, counts] = await Promise.all([
    tx.inventoryProduct.findMany({ where: { id: { in: productIds }, organizationId } }),
    inStockCounts(tx, organizationId, productIds),
  ]);
  const low = products
    .map((p) => ({
      id: p.id,
      kind: p.kind as InventoryKind,
      name: [p.brand, p.name, p.size].filter(Boolean).join(" "),
      inStock: counts.get(p.id) ?? 0,
      reorderPoint: p.reorderPoint,
    }))
    .filter((p) => isLowStock(p.inStock, p.reorderPoint));

  for (const product of low) {
    await enqueueOutbox(tx, organizationId, LOW_STOCK_EVENT, product);
  }
  return low;
}
