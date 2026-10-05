import { type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../../db.js";
import { ApiError } from "../../middlewares/error.middleware.js";
import { queryDate, queryEnum } from "../../utils/query.js";
import { auth, resolveLocationId, tenantScope } from "../../middlewares/auth.middleware.js";
import { auditContext, recordAudit } from "../../lib/audit.js";
import { ACCOUNT_CODES } from "../../domain/accounts.js";
import { postJournalEntry, reverseJournalEntry, trialBalance } from "../../domain/ledger.js";
import { dayBounds } from "../../lib/time.js";
import { classifyLineDepartment } from "../../domain/shopDepartment.js";


export const listExpenses = async (req: Request, res: Response) => {
  const from = queryDate(req.query.from, "from");
  const expenses = await db.expense.findMany({
    where: { ...tenantScope(req), ...(from ? { incurredOn: { gte: from } } : {}) },
    orderBy: { incurredOn: "desc" },
    take: 200,
  });
  res.json({ data: expenses });
};

export const createExpense = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const body = z
    .object({
      category: z.string().min(1),
      vendor: z.string().min(1),
      description: z.string().optional(),
      amount: z.number().int().positive(),
      isCash: z.boolean().default(false),
      incurredOn: z.coerce.date().optional(),
      locationId: z.string().uuid().optional(),
    })
    .parse(req.body);

  const locationId = await resolveLocationId(req, body.locationId);

  const expense = await db.$transaction(async (tx) => {
    const created = await tx.expense.create({
      data: {
        organizationId: ctx.organizationId,
        locationId,
        category: body.category,
        vendor: body.vendor,
        description: body.description,
        amount: body.amount,
        isCash: body.isCash,
        incurredOn: body.incurredOn ?? new Date(),
        recordedById: ctx.userId,
      },
    });

    await postJournalEntry(tx, {
      organizationId: ctx.organizationId,
      memo: `Expense: ${body.vendor}`,
      sourceType: "expense",
      sourceId: created.id,
      postedById: ctx.userId,
      entryDate: created.incurredOn,
      lines: [
        { account: ACCOUNT_CODES.SHOP_EXPENSE, debit: body.amount },
        {
          account: body.isCash ? ACCOUNT_CODES.CASH_DRAWER : ACCOUNT_CODES.ACCOUNTS_PAYABLE,
          credit: body.amount,
        },
      ],
    });
    return created;
  });

  res.status(201).json(expense);
};

export const getReceivables = async (req: Request, res: Response) => {
  const invoices = await db.invoice.findMany({
    where: { ...tenantScope(req), status: { in: ["ISSUED", "PARTLY_PAID"] } },
    include: {
      customer: { select: { id: true, firstName: true, lastName: true, companyName: true } },
    },
    orderBy: { issuedAt: "asc" },
  });

  const now = Date.now();
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
  const rows = invoices.map((i) => {
    const balance = i.total - i.amountPaid - i.amountCredited;
    const ageDays = i.issuedAt
      ? Math.floor((now - i.issuedAt.getTime()) / 86_400_000)
      : 0;
    if (ageDays <= 30) buckets.current += balance;
    else if (ageDays <= 60) buckets.d30 += balance;
    else if (ageDays <= 90) buckets.d60 += balance;
    else if (ageDays <= 120) buckets.d90 += balance;
    else buckets.over90 += balance;

    return {
      id: i.id,
      number: i.number,
      customer: i.customer,
      issuedAt: i.issuedAt,
      dueAt: i.dueAt,
      total: i.total,
      balance,
      ageDays,
    };
  });

  res.json({
    rows,
    buckets,
    totalOutstanding: rows.reduce((s, r) => s + r.balance, 0),
    asOf: new Date().toISOString(),
  });
};

export const listCashSessions = async (req: Request, res: Response) => {
  const sessions = await db.cashSession.findMany({
    where: tenantScope(req),
    orderBy: { openedAt: "desc" },
    take: 60,
    include: {
      openedBy: { select: { firstName: true, lastName: true } },
      location: { select: { name: true } },
    },
  });

  const open = sessions.find((s) => s.closedAt === null) ?? null;
  res.json({ data: sessions, open });
};

export const openCashSession = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const body = z
    .object({ openingFloat: z.number().int().min(0), locationId: z.string().uuid().optional() })
    .parse(req.body);
  const locationId = await resolveLocationId(req, body.locationId);

  const open = await db.cashSession.findFirst({
    where: { locationId, closedAt: null },
  });
  if (open) throw ApiError.conflict("A cash session is already open at this location.");

  const session = await db.cashSession.create({
    data: {
      organizationId: ctx.organizationId,
      locationId,
      openedById: ctx.userId,
      openingFloat: body.openingFloat,
    },
  });
  res.status(201).json(session);
};

export const closeCashSession = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const { countedTotal, note } = z
    .object({ countedTotal: z.number().int().min(0), note: z.string().optional() })
    .parse(req.body);

  const session = await db.cashSession.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!session) throw ApiError.notFound("Cash session not found.");
  if (session.closedAt) throw ApiError.conflict("That session is already closed.");

  const since = { gte: session.openedAt };
  const [receipts, refunds, cashExpenses] = await Promise.all([
    db.payment.aggregate({
      where: {
        organizationId: ctx.organizationId,
        method: { in: ["CASH", "CHECK"] },
        receivedAt: since,
      },
      _sum: { amount: true },
    }),
    db.refund.aggregate({
      where: {
        organizationId: ctx.organizationId,
        status: "SUCCEEDED",
        createdAt: since,
        payment: { method: { in: ["CASH", "CHECK"] } },
      },
      _sum: { amount: true },
    }),
    db.expense.aggregate({
      where: { organizationId: ctx.organizationId, isCash: true, createdAt: since },
      _sum: { amount: true },
    }),
  ]);

  const expected =
    session.openingFloat +
    (receipts._sum.amount ?? 0) -
    (refunds._sum.amount ?? 0) -
    (cashExpenses._sum.amount ?? 0);
  const variance = countedTotal - expected;

  const closed = await db.$transaction(async (tx) => {
    const result = await tx.cashSession.update({
      where: { id: session.id },
      data: { countedTotal, expectedTotal: expected, variance, closedAt: new Date(), note },
    });

    if (variance !== 0) {
      await tx.reconciliationItem.create({
        data: {
          organizationId: ctx.organizationId,
          kind: "cash_variance",
          reference: session.id,
          amount: variance,
          detail: `Counted ${countedTotal} against an expected ${expected}.`,
        },
      });
    }

    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      ...auditContext(req),
      action: "cash.session_closed",
      resourceType: "cash_session",
      resourceId: session.id,
      metadata: { expected, countedTotal, variance },
    });
    return result;
  });

  res.json(closed);
};

export const listReconciliationItems = async (req: Request, res: Response) => {
  const items = await db.reconciliationItem.findMany({
    where: {
      ...tenantScope(req),
      status:
        queryEnum(req.query.status, ["OPEN", "RESOLVED", "IGNORED"] as const, "status") ?? "OPEN",
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const awaitingBank = await db.payment.count({
    where: {
      ...tenantScope(req),
      provider: { not: "manual" },
      bankConfirmedAt: null,
      status: "SUCCEEDED",
    },
  });

  res.json({ items, awaitingBankConfirmation: awaitingBank });
};

export const resolveReconciliationItem = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const { note, status } = z
    .object({
      note: z.string().min(3, "Record how this was resolved."),
      status: z.enum(["RESOLVED", "IGNORED"]).default("RESOLVED"),
    })
    .parse(req.body);

  const item = await db.reconciliationItem.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!item) throw ApiError.notFound("Reconciliation item not found.");

  const resolved = await db.reconciliationItem.update({
    where: { id: item.id },
    data: {
      status,
      resolutionNote: note,
      resolvedById: ctx.userId,
      resolvedAt: new Date(),
    },
  });
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    ...auditContext(req),
    action: "reconciliation.resolved",
    resourceType: "reconciliation_item",
    resourceId: item.id,
    reason: note,
  });
  res.json(resolved);
};

export const confirmBankPayment = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const { reference } = z
    .object({ reference: z.string().min(1, "Enter the bank reference.") })
    .parse(req.body);

  const payment = await db.payment.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!payment) throw ApiError.notFound("Payment not found.");
  if (payment.bankConfirmedAt) throw ApiError.conflict("Already confirmed.");

  const net = payment.amount - payment.feeAmount;
  const updated = await db.$transaction(async (tx) => {
    const result = await tx.payment.update({
      where: { id: payment.id },
      data: { bankConfirmedAt: new Date() },
    });
    await postJournalEntry(tx, {
      organizationId: ctx.organizationId,
      memo: `Payout received (${reference})`,
      sourceType: "payout",
      sourceId: payment.id,
      postedById: ctx.userId,
      lines: [
        { account: ACCOUNT_CODES.BANK, debit: net },
        { account: ACCOUNT_CODES.PROCESSOR_CLEARING, credit: net },
      ],
    });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      ...auditContext(req),
      action: "payout.bank_confirmed",
      resourceType: "payment",
      resourceId: payment.id,
      metadata: { reference, net },
    });
    return result;
  });

  res.json(updated);
};

export const getTrialBalance = async (req: Request, res: Response) => {
  const asOf = queryDate(req.query.asOf, "asOf");
  const rows = await trialBalance(db, auth(req).organizationId, asOf);
  const debits = rows.reduce((s, r) => s + r.debit, 0);
  const credits = rows.reduce((s, r) => s + r.credit, 0);
  res.json({ rows, debits, credits, balanced: debits === credits });
};

export const listJournalEntries = async (req: Request, res: Response) => {
  const entries = await db.journalEntry.findMany({
    where: {
      ...tenantScope(req),
      ...(req.query.sourceType ? { sourceType: String(req.query.sourceType) } : {}),
      ...(req.query.sourceId ? { sourceId: String(req.query.sourceId) } : {}),
    },
    orderBy: { entryDate: "desc" },
    take: 100,
    include: { lines: { include: { account: true } } },
  });
  res.json({ data: entries });
};

export const reverseJournal = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const { reason } = z
    .object({ reason: z.string().min(3, "Give a reason for the reversal.") })
    .parse(req.body);

  const entry = await db.journalEntry.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!entry) throw ApiError.notFound("Journal entry not found.");

  const reversal = await db.$transaction(async (tx) => {
    const created = await reverseJournalEntry(tx, entry.id, reason, ctx.userId);
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      ...auditContext(req),
      action: "journal.reversed",
      resourceType: "journal_entry",
      resourceId: entry.id,
      reason,
    });
    return created;
  });

  res.status(201).json(reversal);
};

export const getDailyClosingSummary = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });

  const dateParam = req.query.date ? String(req.query.date) : null;
  let startOfDay: Date;
  let endOfDay: Date;

  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const targetDate = new Date(`${dateParam}T12:00:00Z`);
    const bounds = dayBounds(org.timezone, targetDate);
    startOfDay = bounds.start;
    endOfDay = bounds.end;
  } else {
    const bounds = dayBounds(org.timezone);
    startOfDay = bounds.start;
    endOfDay = bounds.end;
  }

  // 1. Fetch cash sessions opened on this date (or latest session)
  const sessions = await db.cashSession.findMany({
    where: {
      ...tenantScope(req),
      openedAt: { gte: startOfDay, lte: endOfDay },
    },
    orderBy: { openedAt: "desc" },
    include: {
      openedBy: { select: { firstName: true, lastName: true } },
      location: { select: { name: true } },
    },
  });

  const activeSession = sessions.find((s) => s.closedAt === null) || sessions[0] || null;

  // 2. Fetch all payments received in this timeframe
  const payments = await db.payment.findMany({
    where: {
      organizationId: ctx.organizationId,
      receivedAt: { gte: startOfDay, lte: endOfDay },
      status: "SUCCEEDED",
    },
    include: {
      customer: { select: { firstName: true, lastName: true, companyName: true } },
      allocations: {
        include: {
          invoice: {
            include: {
              lines: {
                include: {
                  inventoryUnits: {
                    include: { product: { select: { kind: true } } },
                  },
                },
              },
            },
          },
        },
      },
      refunds: { where: { status: "SUCCEEDED" } },
    },
    orderBy: { receivedAt: "desc" },
  });

  // 3. Fetch refunds in this timeframe
  const refunds = await db.refund.findMany({
    where: {
      organizationId: ctx.organizationId,
      status: "SUCCEEDED",
      createdAt: { gte: startOfDay, lte: endOfDay },
    },
    include: { payment: true },
  });

  // 4. Fetch expenses incurred in this timeframe
  const expenses = await db.expense.findMany({
    where: {
      organizationId: ctx.organizationId,
      createdAt: { gte: startOfDay, lte: endOfDay },
    },
  });

  // Aggregation containers
  type DeptClosing = {
    shopName: string;
    cashReceipts: number;
    cardReceipts: number;
    checkReceipts: number;
    otherReceipts: number;
    totalCollected: number;
    taxCollected: number;
    netSales: number;
    refundsTotal: number;
    cashExpenses: number;
    closingCashBalance: number;
    transactionsCount: number;
    payments: Array<{
      id: string;
      customer: string;
      method: string;
      amount: number;
      receivedAt: string;
      reference: string | null;
    }>;
  };

  const tireShop: DeptClosing = {
    shopName: "Tire Shop",
    cashReceipts: 0,
    cardReceipts: 0,
    checkReceipts: 0,
    otherReceipts: 0,
    totalCollected: 0,
    taxCollected: 0,
    netSales: 0,
    refundsTotal: 0,
    cashExpenses: 0,
    closingCashBalance: 0,
    transactionsCount: 0,
    payments: [],
  };

  const mufflersShop: DeptClosing = {
    shopName: "Mufflers Shop",
    cashReceipts: 0,
    cardReceipts: 0,
    checkReceipts: 0,
    otherReceipts: 0,
    totalCollected: 0,
    taxCollected: 0,
    netSales: 0,
    refundsTotal: 0,
    cashExpenses: 0,
    closingCashBalance: 0,
    transactionsCount: 0,
    payments: [],
  };

  for (const p of payments) {
    const custName = [p.customer?.firstName, p.customer?.lastName].filter(Boolean).join(" ") || p.customer?.companyName || "Counter Sale";

    // Inspect settled lines across all allocated invoices
    let tireLineTotal = 0;
    let mufflerLineTotal = 0;
    let tireTax = 0;
    let mufflerTax = 0;

    for (const alloc of p.allocations) {
      for (const line of alloc.invoice.lines) {
        const dept = classifyLineDepartment(line);
        if (dept === "TIRE") {
          tireLineTotal += line.lineTotal;
          tireTax += line.taxAmount;
        } else if (dept === "MUFFLER") {
          mufflerLineTotal += line.lineTotal;
          mufflerTax += line.taxAmount;
        }
      }
    }

    const totalAllocated = tireLineTotal + mufflerLineTotal;

    let tireShare = 0.5;
    let mufflerShare = 0.5;

    if (totalAllocated > 0) {
      tireShare = tireLineTotal / totalAllocated;
      mufflerShare = mufflerLineTotal / totalAllocated;
    } else {
      // Default to 50/50 or check payment reference keywords
      const ref = (p.reference ?? "").toLowerCase();
      if (ref.includes("tire")) {
        tireShare = 1;
        mufflerShare = 0;
      } else if (ref.includes("muffler") || ref.includes("exhaust")) {
        tireShare = 0;
        mufflerShare = 1;
      }
    }

    const tireAmount = Math.round(p.amount * tireShare);
    const mufflerAmount = p.amount - tireAmount;

    if (tireAmount > 0) {
      tireShop.totalCollected += tireAmount;
      tireShop.transactionsCount += 1;
      tireShop.taxCollected += Math.round(tireTax * tireShare);
      tireShop.netSales += Math.max(0, tireAmount - Math.round(tireTax * tireShare));

      if (p.method === "CASH") tireShop.cashReceipts += tireAmount;
      else if (p.method === "CHECK") tireShop.checkReceipts += tireAmount;
      else if (p.method.includes("CARD")) tireShop.cardReceipts += tireAmount;
      else tireShop.otherReceipts += tireAmount;

      tireShop.payments.push({
        id: p.id,
        customer: custName,
        method: p.method,
        amount: tireAmount,
        receivedAt: p.receivedAt.toISOString(),
        reference: p.reference,
      });
    }

    if (mufflerAmount > 0) {
      mufflersShop.totalCollected += mufflerAmount;
      mufflersShop.transactionsCount += 1;
      mufflersShop.taxCollected += Math.round(mufflerTax * mufflerShare);
      mufflersShop.netSales += Math.max(0, mufflerAmount - Math.round(mufflerTax * mufflerShare));

      if (p.method === "CASH") mufflersShop.cashReceipts += mufflerAmount;
      else if (p.method === "CHECK") mufflersShop.checkReceipts += mufflerAmount;
      else if (p.method.includes("CARD")) mufflersShop.cardReceipts += mufflerAmount;
      else mufflersShop.otherReceipts += mufflerAmount;

      mufflersShop.payments.push({
        id: p.id,
        customer: custName,
        method: p.method,
        amount: mufflerAmount,
        receivedAt: p.receivedAt.toISOString(),
        reference: p.reference,
      });
    }
  }

  // Apportion expenses
  for (const exp of expenses) {
    const text = `${exp.category} ${exp.vendor} ${exp.description ?? ""}`.toLowerCase();
    const isTire = text.includes("tire") || text.includes("wheel") || text.includes("valve");
    const isMuffler = text.includes("muffler") || text.includes("exhaust") || text.includes("pipe") || text.includes("weld");

    if (isTire && !isMuffler) {
      tireShop.cashExpenses += exp.isCash ? exp.amount : 0;
    } else if (isMuffler && !isTire) {
      mufflersShop.cashExpenses += exp.isCash ? exp.amount : 0;
    } else {
      // Split general cash expenses evenly
      const half = Math.round(exp.amount / 2);
      if (exp.isCash) {
        tireShop.cashExpenses += half;
        mufflersShop.cashExpenses += exp.amount - half;
      }
    }
  }

  // Apportion refunds
  for (const ref of refunds) {
    const half = Math.round(ref.amount / 2);
    tireShop.refundsTotal += half;
    mufflersShop.refundsTotal += ref.amount - half;
  }

  tireShop.closingCashBalance = Math.max(0, tireShop.cashReceipts - tireShop.cashExpenses - (tireShop.refundsTotal > 0 ? tireShop.refundsTotal : 0));
  mufflersShop.closingCashBalance = Math.max(0, mufflersShop.cashReceipts - mufflersShop.cashExpenses - (mufflersShop.refundsTotal > 0 ? mufflersShop.refundsTotal : 0));

  const totalOpeningFloat = activeSession ? activeSession.openingFloat : 20000;
  const totalCashReceipts = tireShop.cashReceipts + mufflersShop.cashReceipts;
  const totalCashExpenses = tireShop.cashExpenses + mufflersShop.cashExpenses;
  const totalCashRefunds = refunds.filter((r) => r.payment.method === "CASH").reduce((s, r) => s + r.amount, 0);

  const calculatedExpectedDrawer = totalOpeningFloat + totalCashReceipts - totalCashExpenses - totalCashRefunds;
  const countedDrawer = activeSession?.countedTotal ?? null;
  const variance = countedDrawer !== null ? countedDrawer - calculatedExpectedDrawer : null;

  res.json({
    date: dateParam || startOfDay.toISOString().slice(0, 10),
    asOf: new Date().toISOString(),
    session: activeSession,
    drawerSummary: {
      openingFloat: totalOpeningFloat,
      cashReceipts: totalCashReceipts,
      cashExpenses: totalCashExpenses,
      cashRefunds: totalCashRefunds,
      expectedTotal: calculatedExpectedDrawer,
      countedTotal: countedDrawer,
      variance,
      status: activeSession?.closedAt ? "CLOSED" : "OPEN",
    },
    tireShop,
    mufflersShop,
    combined: {
      totalCollected: tireShop.totalCollected + mufflersShop.totalCollected,
      totalNetSales: tireShop.netSales + mufflersShop.netSales,
      totalTax: tireShop.taxCollected + mufflersShop.taxCollected,
      totalCash: totalCashReceipts,
      totalCard: tireShop.cardReceipts + mufflersShop.cardReceipts,
      totalCheck: tireShop.checkReceipts + mufflersShop.checkReceipts,
      transactionsCount: payments.length,
    },
  });
};

