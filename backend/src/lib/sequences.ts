import crypto from "node:crypto";
import type { Tx } from "./prisma.js";

export type SequenceKind = "estimate" | "repair_order" | "invoice" | "credit_note";

const PREFIXES: Record<SequenceKind, string> = {
  estimate: "EST",
  repair_order: "RO",
  invoice: "INV",
  credit_note: "CN",
};

/**
 * Per-tenant document numbers. The row is locked for update inside the caller's
 * transaction, so two advisors issuing at the same moment cannot take the same
 * number.
 */
export async function nextNumber(
  tx: Tx,
  organizationId: string,
  kind: SequenceKind,
): Promise<string> {
  const prefix = PREFIXES[kind];

  // Identifiers are backtick-quoted: MySQL reads double quotes as a string
  // literal unless ANSI_QUOTES is set, so `WHERE "organizationId" = ?` would
  // compare the constant 'organizationId' to the parameter and match nothing.
  //
  // SELECT ... FOR UPDATE takes an InnoDB row lock held until the caller's
  // transaction commits, which is what serialises two advisors issuing a
  // number at the same moment.
  const rows = await tx.$queryRaw<Array<{ id: string; nextValue: number }>>`
    SELECT \`id\`, \`nextValue\`
    FROM \`number_sequences\`
    WHERE \`organizationId\` = ${organizationId} AND \`kind\` = ${kind}
    FOR UPDATE
  `;

  if (rows.length === 0) {
    await tx.numberSequence.create({
      data: { organizationId, kind, prefix, nextValue: 1001 },
    });
    return `${prefix}-1000`;
  }

  const current = rows[0];
  await tx.numberSequence.update({
    where: { id: current.id },
    data: { nextValue: current.nextValue + 1 },
  });
  return `${prefix}-${current.nextValue}`;
}

/** Single-resource, expiring approval token (build guide / 03). */
export function newApprovalToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
