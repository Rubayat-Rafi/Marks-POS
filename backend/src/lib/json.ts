/**
 * Reading JSON columns that stand in for Postgres scalar lists.
 *
 * MySQL has no array type, so two fields that were `String[]` on Postgres are
 * `Json?` here: `InspectionItem.photoKeys` and `EstimateApproval.approvedLineIds`.
 * Prisma types those as `JsonValue`, and a row written by the SQL import or by
 * hand can hold NULL, so nothing may assume an array came back.
 *
 * The HTTP contract is unchanged: both fields are still arrays of strings on
 * the wire, which is what the web app's types declare.
 */
import type { Prisma } from "@prisma/client";

/** A JSON column read back as a string array, defaulting to empty. */
export function stringArray(value: Prisma.JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

type InspectionItemRow = { photoKeys: Prisma.JsonValue };
type InspectionRow<T extends InspectionItemRow> = { items: T[] };

/**
 * Restore `photoKeys: string[]` on an inspection loaded from the database,
 * so responses keep the shape the web app expects.
 */
export function withPhotoKeys<T extends InspectionItemRow, I extends InspectionRow<T>>(
  inspection: I,
): Omit<I, "items"> & { items: Array<Omit<T, "photoKeys"> & { photoKeys: string[] }> } {
  return {
    ...inspection,
    items: inspection.items.map((item) => ({
      ...item,
      photoKeys: stringArray(item.photoKeys),
    })),
  };
}
