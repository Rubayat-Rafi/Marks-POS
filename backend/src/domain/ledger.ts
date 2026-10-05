import type { Tx } from "../lib/prisma.js";
import { ApiError } from "../middlewares/error.middleware.js";
import { ACCOUNT_CODES, type AccountCode } from "./accounts.js";

export type PostingLine = {
  account: AccountCode;
  debit?: number;
  credit?: number;
  memo?: string;
};

export type PostingInput = {
  organizationId: string;
  memo: string;
  sourceType: string;
  sourceId: string;
  postedById?: string | null;
  entryDate?: Date;
  lines: PostingLine[];
};

/**
 * Post a balanced journal entry.
 *
 * Refuses unbalanced input rather than storing it: an unbalanced subledger is
 * worse than a failed request. Callers pass the same transaction client that
 * carries the business change, so the two commit or fail together.
 */
export async function postJournalEntry(tx: Tx, input: PostingInput) {
  const lines = input.lines
    .map((l) => ({ ...l, debit: l.debit ?? 0, credit: l.credit ?? 0 }))
    .filter((l) => l.debit !== 0 || l.credit !== 0);

  if (lines.length === 0) {
    throw ApiError.unprocessable("A journal entry needs at least one non-zero line.");
  }

  const debits = lines.reduce((sum, l) => sum + l.debit, 0);
  const credits = lines.reduce((sum, l) => sum + l.credit, 0);
  if (debits !== credits) {
    throw ApiError.unprocessable(
      `Journal entry does not balance: debits ${debits} vs credits ${credits}.`,
    );
  }
  if (lines.some((l) => l.debit < 0 || l.credit < 0)) {
    throw ApiError.unprocessable("Journal lines cannot be negative. Swap the side instead.");
  }

  const accounts = await tx.account.findMany({
    where: { organizationId: input.organizationId },
    select: { id: true, code: true },
  });
  const byCode = new Map(accounts.map((a) => [a.code, a.id]));

  const missing = lines.map((l) => l.account).filter((code) => !byCode.has(code));
  if (missing.length > 0) {
    throw ApiError.unprocessable(
      `Chart of accounts is missing ${[...new Set(missing)].join(", ")}. Run the seed or settings bootstrap.`,
    );
  }

  return tx.journalEntry.create({
    data: {
      organizationId: input.organizationId,
      memo: input.memo,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      postedById: input.postedById ?? null,
      entryDate: input.entryDate ?? new Date(),
      lines: {
        create: lines.map((l) => ({
          accountId: byCode.get(l.account)!,
          debit: l.debit,
          credit: l.credit,
          memo: l.memo,
        })),
      },
    },
    include: { lines: true },
  });
}

/**
 * Corrections never edit a posted entry. They create a linked mirror entry
 * (build guide / 07).
 */
export async function reverseJournalEntry(
  tx: Tx,
  entryId: string,
  memo: string,
  postedById?: string | null,
) {
  const original = await tx.journalEntry.findUnique({
    where: { id: entryId },
    include: { lines: { include: { account: true } } },
  });
  if (!original) throw ApiError.notFound("Journal entry not found.");

  const existing = await tx.journalEntry.findFirst({ where: { reversesId: entryId } });
  if (existing) throw ApiError.conflict("That entry has already been reversed.");

  return tx.journalEntry.create({
    data: {
      organizationId: original.organizationId,
      memo,
      sourceType: `reversal:${original.sourceType}`,
      sourceId: original.sourceId,
      reversesId: original.id,
      postedById: postedById ?? null,
      lines: {
        create: original.lines.map((l) => ({
          accountId: l.accountId,
          debit: l.credit,
          credit: l.debit,
          memo: `Reversal of ${l.memo ?? original.memo}`,
        })),
      },
    },
    include: { lines: true },
  });
}

/** Trial balance by account, used by the finance screen and by tests. */
export async function trialBalance(tx: Tx, organizationId: string, asOf?: Date) {
  const rows = await tx.journalLine.groupBy({
    by: ["accountId"],
    where: {
      journalEntry: {
        organizationId,
        ...(asOf ? { entryDate: { lte: asOf } } : {}),
      },
    },
    _sum: { debit: true, credit: true },
  });

  const accounts = await tx.account.findMany({
    where: { organizationId },
    orderBy: { code: "asc" },
  });

  const byId = new Map(rows.map((r) => [r.accountId, r]));
  return accounts.map((a) => {
    const row = byId.get(a.id);
    const debit = row?._sum.debit ?? 0;
    const credit = row?._sum.credit ?? 0;
    // Assets and expenses are debit-normal; the rest are credit-normal.
    const normalDebit = a.type === "ASSET" || a.type === "EXPENSE";
    return {
      code: a.code,
      name: a.name,
      type: a.type,
      debit,
      credit,
      balance: normalDebit ? debit - credit : credit - debit,
    };
  });
}

export { ACCOUNT_CODES };
