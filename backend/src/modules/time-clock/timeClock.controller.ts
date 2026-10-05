import { type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../../db.js";
import { ApiError } from "../../middlewares/error.middleware.js";
import { queryDate } from "../../utils/query.js";
import { auth, tenantScope } from "../../middlewares/auth.middleware.js";
import { auditContext, recordAudit } from "../../lib/audit.js";

function hoursBetween(start: Date, end: Date): number {
  return Math.max(0, (end.getTime() - start.getTime()) / 3_600_000);
}

export const getStatus = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const open = await db.shiftClockEntry.findFirst({
    where: { organizationId: ctx.organizationId, userId: ctx.userId, clockOutAt: null },
    orderBy: { clockInAt: "desc" },
  });
  res.json({
    clockedIn: Boolean(open),
    entry: open,
    openHours: open ? hoursBetween(open.clockInAt, new Date()) : 0,
  });
};

export const clockIn = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const body = z.object({ note: z.string().optional() }).parse(req.body ?? {});

  const existing = await db.shiftClockEntry.findFirst({
    where: { organizationId: ctx.organizationId, userId: ctx.userId, clockOutAt: null },
  });
  if (existing) {
    throw ApiError.conflict("You are already clocked in. Clock out before clocking in again.");
  }

  const entry = await db.shiftClockEntry.create({
    data: {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      locationId: ctx.locationId,
      note: body.note,
    },
  });
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    ...auditContext(req),
    action: "timeclock.clock_in",
    resourceType: "shift_clock_entry",
    resourceId: entry.id,
  });
  res.status(201).json(entry);
};

export const clockOut = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const body = z.object({ note: z.string().optional() }).parse(req.body ?? {});

  const open = await db.shiftClockEntry.findFirst({
    where: { organizationId: ctx.organizationId, userId: ctx.userId, clockOutAt: null },
    orderBy: { clockInAt: "desc" },
  });
  if (!open) throw ApiError.unprocessable("You are not currently clocked in.");

  const entry = await db.shiftClockEntry.update({
    where: { id: open.id },
    data: {
      clockOutAt: new Date(),
      note: body.note ?? open.note,
    },
  });
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    ...auditContext(req),
    action: "timeclock.clock_out",
    resourceType: "shift_clock_entry",
    resourceId: entry.id,
    metadata: { hours: hoursBetween(entry.clockInAt, entry.clockOutAt!) },
  });
  res.json(entry);
};

export const getMyHistory = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const from = queryDate(req.query.from, "from");
  const to = queryDate(req.query.to, "to");

  const entries = await db.shiftClockEntry.findMany({
    where: {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      ...(from || to
        ? { clockInAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    },
    orderBy: { clockInAt: "desc" },
    take: 200,
  });

  const totalHours = entries.reduce(
    (sum, e) => sum + hoursBetween(e.clockInAt, e.clockOutAt ?? new Date()),
    0,
  );
  res.json({ data: entries, totalHours });
};

export const listAllEntries = async (req: Request, res: Response) => {
  const from = queryDate(req.query.from, "from");
  const to = queryDate(req.query.to, "to");
  const userId = req.query.userId ? String(req.query.userId) : undefined;

  const entries = await db.shiftClockEntry.findMany({
    where: {
      ...tenantScope(req),
      ...(userId ? { userId } : {}),
      ...(from || to
        ? { clockInAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    },
    orderBy: { clockInAt: "desc" },
    take: 500,
    include: { user: { select: { firstName: true, lastName: true } } },
  });
  res.json({ data: entries });
};

export const updateEntry = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const body = z
    .object({
      clockInAt: z.coerce.date().optional(),
      clockOutAt: z.coerce.date().nullable().optional(),
      note: z.string().optional(),
      reason: z.string().min(3, "Give a reason for the correction."),
    })
    .parse(req.body);

  const entry = await db.shiftClockEntry.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!entry) throw ApiError.notFound("Time clock entry not found.");

  const updated = await db.shiftClockEntry.update({
    where: { id: entry.id },
    data: {
      clockInAt: body.clockInAt,
      clockOutAt: body.clockOutAt,
      note: body.note,
    },
  });
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    ...auditContext(req),
    action: "timeclock.corrected",
    resourceType: "shift_clock_entry",
    resourceId: entry.id,
    reason: body.reason,
    metadata: { before: entry, after: updated },
  });
  res.json(updated);
};

export const getPayrollSummary = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const from = queryDate(req.query.from, "from") ?? new Date(Date.now() - 14 * 86_400_000);
  const to = queryDate(req.query.to, "to") ?? new Date();

  const [memberships, entries] = await Promise.all([
    db.membership.findMany({
      where: { organizationId: ctx.organizationId, isActive: true },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    }),
    db.shiftClockEntry.findMany({
      where: { organizationId: ctx.organizationId, clockInAt: { gte: from, lte: to } },
    }),
  ]);

  const hoursByUser = new Map<string, number>();
  for (const e of entries) {
    const h = hoursBetween(e.clockInAt, e.clockOutAt ?? new Date());
    hoursByUser.set(e.userId, (hoursByUser.get(e.userId) ?? 0) + h);
  }

  const rows = memberships
    .filter((m) => m.payType)
    .map((m) => {
      const hours = hoursByUser.get(m.userId) ?? 0;
      const estimatedPay =
        m.payType === "HOURLY" ? Math.round(hours * (m.payRateCents ?? 0)) : (m.payRateCents ?? 0);
      return {
        membershipId: m.id,
        userId: m.userId,
        name: `${m.user.firstName} ${m.user.lastName}`,
        role: m.role,
        employmentType: m.employmentType,
        payType: m.payType,
        payRateCents: m.payRateCents,
        hours: Number(hours.toFixed(2)),
        estimatedPay,
      };
    });

  res.json({
    from,
    to,
    rows,
    totalEstimatedPay: rows.reduce((s, r) => s + r.estimatedPay, 0),
    note: "An operational estimate from clocked hours and configured pay rates. It is not a payroll tax filing.",
  });
};
