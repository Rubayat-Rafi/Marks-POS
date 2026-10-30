import { type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../../db.js";
import { ApiError } from "../../middlewares/error.middleware.js";
import { auth, tenantScope } from "../../middlewares/auth.middleware.js";
import { assertPermission, can } from "../../middlewares/rbac.middleware.js";
import { auditContext, recordAudit } from "../../lib/audit.js";
import { implementedProviders } from "../../providers/registry.js";
import { CHART_OF_ACCOUNTS } from "../../domain/accounts.js";

export const getSettings = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const [organization, locations, laborRates, suppliers, connections] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } }),
    db.location.findMany({ where: tenantScope(req), orderBy: { name: "asc" } }),
    db.laborRate.findMany({ where: tenantScope(req), orderBy: { name: "asc" } }),
    db.supplier.findMany({ where: tenantScope(req), orderBy: { name: "asc" } }),
    db.providerConnection.findMany({ where: tenantScope(req) }),
  ]);

  res.json({
    organization,
    locations,
    laborRates,
    suppliers,
    providerConnections: connections.map(({ secretRef, ...c }) => ({
      ...c,
      hasCredentials: Boolean(secretRef),
    })),
    implementedPaymentProviders: implementedProviders(),
  });
};

export const updateOrganization = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const body = z
    .object({
      name: z.string().min(1).optional(),
      legalName: z.string().optional().nullable(),
      timezone: z.string().optional(),
      taxRateBps: z.number().int().min(0).max(3000).optional(),
      taxesParts: z.boolean().optional(),
      taxesLabor: z.boolean().optional(),
      taxesFees: z.boolean().optional(),
      paymentProvider: z.string().optional(),
    })
    .parse(req.body);

  if (body.paymentProvider) {
    const available = implementedProviders().map((p) => p.name);
    if (!available.includes(body.paymentProvider)) {
      throw ApiError.unprocessable(
        `"${body.paymentProvider}" has no adapter in this build. Implemented: ${available.join(", ")}.`,
      );
    }
  }

  const before = await db.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
  });
  const organization = await db.organization.update({
    where: { id: ctx.organizationId },
    data: body,
  });

  await recordAudit(db, {
    organizationId: ctx.organizationId,
    ...auditContext(req),
    action: "settings.organization_updated",
    resourceType: "organization",
    resourceId: ctx.organizationId,
    metadata: {
      before: { taxRateBps: before.taxRateBps, paymentProvider: before.paymentProvider },
      after: { taxRateBps: organization.taxRateBps, paymentProvider: organization.paymentProvider },
    },
  });

  res.json(organization);
};

export const listStaff = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const memberships = await db.membership.findMany({
    where: tenantScope(req),
    include: {
      user: { select: { id: true, email: true, firstName: true, lastName: true, isActive: true, lastLoginAt: true } },
      location: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const showAllPay = can(ctx.role, "payroll.read");
  res.json({
    data: memberships.map((m) => {
      const showThisPay = showAllPay || m.userId === ctx.userId;
      return showThisPay
        ? m
        : { ...m, employmentType: null, payType: null, payRateCents: null, hireDate: null };
    }),
  });
};

export const listTechnicians = async (req: Request, res: Response) => {
  const memberships = await db.membership.findMany({
    where: {
      ...tenantScope(req),
      isActive: true,
      role: { in: ["TECHNICIAN", "MANAGER", "OWNER"] },
    },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: "asc" },
  });

  res.json({
    data: memberships.map((m) => ({
      id: m.user.id,
      name: `${m.user.firstName} ${m.user.lastName}`,
      role: m.role,
    })),
  });
};

const employmentFieldsSchema = z.object({
  employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACTOR"]).optional().nullable(),
  payType: z.enum(["HOURLY", "SALARY"]).optional().nullable(),
  payRate: z.number().min(0).optional().nullable(),
  hireDate: z.coerce.date().optional().nullable(),
});

export const addStaff = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const body = z
    .object({
      email: z.string().email(),
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      password: z.string().min(10, "Use at least 10 characters."),
      role: z.enum(["OWNER", "MANAGER", "SERVICE_ADVISOR", "TECHNICIAN", "BOOKKEEPER"]),
      locationId: z.string().uuid().optional().nullable(),
    })
    .and(employmentFieldsSchema)
    .parse(req.body);

  if (body.payType || body.payRate !== undefined || body.employmentType) {
    assertPermission(ctx.role, "payroll.write");
  }

  const email = body.email.toLowerCase();
  const user = await db.user.upsert({
    where: { email },
    create: {
      email,
      firstName: body.firstName,
      lastName: body.lastName,
      passwordHash: await bcrypt.hash(body.password, 12),
    },
    update: {},
  });

  const existing = await db.membership.findFirst({
    where: { userId: user.id, organizationId: ctx.organizationId },
  });
  if (existing) throw ApiError.conflict("That person is already on your team.");

  const membership = await db.membership.create({
    data: {
      userId: user.id,
      organizationId: ctx.organizationId,
      locationId: body.locationId ?? null,
      role: body.role,
      employmentType: body.employmentType ?? null,
      payType: body.payType ?? null,
      payRateCents:
        body.payRate !== undefined && body.payRate !== null
          ? Math.round(body.payRate * 100)
          : null,
      hireDate: body.hireDate ?? null,
    },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
  });

  await recordAudit(db, {
    organizationId: ctx.organizationId,
    ...auditContext(req),
    action: "staff.added",
    resourceType: "membership",
    resourceId: membership.id,
    metadata: { role: body.role, email },
  });
  res.status(201).json(membership);
};

export const updateStaff = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const body = z
    .object({
      role: z.enum(["OWNER", "MANAGER", "SERVICE_ADVISOR", "TECHNICIAN", "BOOKKEEPER"]).optional(),
      locationId: z.string().uuid().nullable().optional(),
      firstName: z.string().min(1).optional(),
      lastName: z.string().min(1).optional(),
      email: z.string().email().optional(),
      phone: z.string().nullable().optional(),
      password: z.string().min(10, "Use at least 10 characters.").optional().or(z.literal("")),
    })
    .and(employmentFieldsSchema)
    .parse(req.body);

  const membership = await db.membership.findFirst({
    where: { id: req.params.membershipId, ...tenantScope(req) },
  });
  if (!membership) throw ApiError.notFound("Team member not found.");

  const touchesPay =
    body.employmentType !== undefined || body.payType !== undefined || body.payRate !== undefined;
  if (touchesPay) assertPermission(ctx.role, "payroll.write");

  if (membership.role === "OWNER" && body.role && body.role !== "OWNER") {
    const owners = await db.membership.count({
      where: { organizationId: ctx.organizationId, role: "OWNER", isActive: true },
    });
    if (owners <= 1) throw ApiError.unprocessable("A shop needs at least one active owner.");
  }

  const userData: { firstName?: string; lastName?: string; email?: string; phone?: string | null; passwordHash?: string } = {};
  if (body.firstName !== undefined) userData.firstName = body.firstName;
  if (body.lastName !== undefined) userData.lastName = body.lastName;
  if (body.phone !== undefined) userData.phone = body.phone || null;
  if (body.email !== undefined) {
    const email = body.email.toLowerCase();
    const taken = await db.user.findFirst({
      where: { email, NOT: { id: membership.userId } },
    });
    if (taken) throw ApiError.conflict("Another account already uses that email.");
    userData.email = email;
  }
  if (body.password) userData.passwordHash = await bcrypt.hash(body.password, 12);
  if (Object.keys(userData).length > 0) {
    await db.user.update({ where: { id: membership.userId }, data: userData });
  }

  const updated = await db.membership.update({
    where: { id: membership.id },
    data: {
      role: body.role,
      locationId: body.locationId,
      ...(touchesPay
        ? {
            employmentType: body.employmentType,
            payType: body.payType,
            payRateCents:
              body.payRate !== undefined && body.payRate !== null
                ? Math.round(body.payRate * 100)
                : body.payRate,
            hireDate: body.hireDate,
          }
        : {}),
    },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
  });

  await recordAudit(db, {
    organizationId: ctx.organizationId,
    ...auditContext(req),
    action: touchesPay ? "staff.pay_updated" : "staff.updated",
    resourceType: "membership",
    resourceId: membership.id,
    metadata: { changedFields: Object.keys(body).filter((k) => k !== "password").concat(body.password ? ["password"] : []) },
  });
  res.json(updated);
};

export const deactivateStaff = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const membership = await db.membership.findFirst({
    where: { id: req.params.membershipId, ...tenantScope(req) },
  });
  if (!membership) throw ApiError.notFound("Team member not found.");
  if (membership.userId === ctx.userId) {
    throw ApiError.unprocessable("You cannot remove your own access.");
  }

  const owners = await db.membership.count({
    where: { organizationId: ctx.organizationId, role: "OWNER", isActive: true },
  });
  if (membership.role === "OWNER" && owners <= 1) {
    throw ApiError.unprocessable("A shop needs at least one active owner.");
  }

  const updated = await db.membership.update({
    where: { id: membership.id },
    data: { isActive: false },
  });
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    ...auditContext(req),
    action: "staff.deactivated",
    resourceType: "membership",
    resourceId: membership.id,
  });
  res.json(updated);
};

export const deleteStaff = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const membership = await db.membership.findFirst({
    where: { id: req.params.membershipId, ...tenantScope(req) },
  });
  if (!membership) throw ApiError.notFound("Team member not found.");
  if (membership.userId === ctx.userId) {
    throw ApiError.unprocessable("You cannot delete your own account.");
  }
  if (membership.role === "OWNER") {
    const owners = await db.membership.count({
      where: { organizationId: ctx.organizationId, role: "OWNER", isActive: true },
    });
    if (membership.isActive && owners <= 1) {
      throw ApiError.unprocessable("A shop needs at least one active owner.");
    }
  }

  await db.membership.delete({ where: { id: membership.id } });

  // Remove the login too when it belongs to no other shop. Users still
  // referenced by historical records (time entries, cash sessions) are kept
  // without any access, so that history stays intact.
  const remaining = await db.membership.count({ where: { userId: membership.userId } });
  if (remaining === 0) {
    try {
      await db.user.delete({ where: { id: membership.userId } });
    } catch {
      /* referenced by history: keep the record, access is already gone */
    }
  }

  await recordAudit(db, {
    organizationId: ctx.organizationId,
    ...auditContext(req),
    action: "staff.deleted",
    resourceType: "membership",
    resourceId: membership.id,
  });
  res.json({ success: true });
};

export const listLaborRates = async (req: Request, res: Response) => {
  const rates = await db.laborRate.findMany({
    where: tenantScope(req),
    orderBy: { name: "asc" },
  });
  res.json({ data: rates });
};

export const createLaborRate = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const body = z
    .object({
      name: z.string().min(1),
      ratePerHour: z.number().int().min(0),
      costPerHour: z.number().int().min(0).default(0),
      isDefault: z.boolean().default(false),
    })
    .parse(req.body);

  if (body.isDefault) {
    await db.laborRate.updateMany({
      where: tenantScope(req),
      data: { isDefault: false },
    });
  }
  const rate = await db.laborRate.create({
    data: { ...body, organizationId: ctx.organizationId },
  });
  res.status(201).json(rate);
};

export const listCatalogItems = async (req: Request, res: Response) => {
  const q = String(req.query.q ?? "").trim();
  const make = String(req.query.make ?? "").trim();
  const model = String(req.query.model ?? "").trim();
  const year = req.query.year ? Number(req.query.year) : undefined;

  const items = await db.catalogItem.findMany({
    where: {
      ...tenantScope(req),
      isActive: true,
      ...(q
        ? {
            OR: [
              { partNumber: { contains: q } },
              { description: { contains: q } },
            ],
          }
        : {}),
      ...(make || model || year !== undefined
        ? {
            fitments: {
              some: {
                ...(make ? { make: { equals: make } } : {}),
                ...(model ? { model: { equals: model } } : {}),
                ...(year !== undefined
                  ? { yearFrom: { lte: year }, yearTo: { gte: year } }
                  : {}),
              },
            },
          }
        : {}),
    },
    orderBy: { description: "asc" },
    take: 100,
    include: {
      supplier: { select: { id: true, name: true } },
      fitments: true,
    },
  });
  res.json({ data: items });
};

export const getCatalogItemById = async (req: Request, res: Response) => {
  const item = await db.catalogItem.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: { supplier: { select: { id: true, name: true } }, fitments: true },
  });
  if (!item) throw ApiError.notFound("Part not found.");
  res.json(item);
};

const fitmentSchema = z
  .object({
    make: z.string().min(1),
    model: z.string().min(1),
    yearFrom: z.number().int().min(1900).max(2100),
    yearTo: z.number().int().min(1900).max(2100),
    notes: z.string().optional(),
  })
  .refine((f) => f.yearTo >= f.yearFrom, {
    message: "The end year must be the same as or after the start year.",
    path: ["yearTo"],
  });

export const createCatalogItem = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const body = z
    .object({
      partNumber: z.string().min(1),
      description: z.string().min(1),
      category: z.string().default("Parts"),
      costCents: z.number().int().min(0),
      priceCents: z.number().int().min(0),
      onHand: z.number().min(0).default(0),
      supplierId: z.string().uuid().optional().nullable(),
      fitments: z.array(fitmentSchema).default([]),
    })
    .parse(req.body);

  const item = await db.catalogItem.create({
    data: {
      organizationId: ctx.organizationId,
      partNumber: body.partNumber,
      description: body.description,
      category: body.category,
      costCents: body.costCents,
      priceCents: body.priceCents,
      onHand: body.onHand,
      supplierId: body.supplierId,
      fitments: { create: body.fitments },
    },
    include: { fitments: true },
  });
  res.status(201).json(item);
};

export const updateCatalogItem = async (req: Request, res: Response) => {
  const body = z
    .object({
      description: z.string().min(1).optional(),
      category: z.string().optional(),
      costCents: z.number().int().min(0).optional(),
      priceCents: z.number().int().min(0).optional(),
      onHand: z.number().min(0).optional(),
      supplierId: z.string().uuid().nullable().optional(),
      isActive: z.boolean().optional(),
    })
    .parse(req.body);

  const existing = await db.catalogItem.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!existing) throw ApiError.notFound("Part not found.");

  const item = await db.catalogItem.update({
    where: { id: existing.id },
    data: body,
    include: { fitments: true },
  });
  res.json(item);
};

export const addFitment = async (req: Request, res: Response) => {
  const body = fitmentSchema.parse(req.body);

  const item = await db.catalogItem.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!item) throw ApiError.notFound("Part not found.");

  const fitment = await db.partFitment.create({
    data: { ...body, catalogItemId: item.id },
  });
  res.status(201).json(fitment);
};

export const deleteFitment = async (req: Request, res: Response) => {
  const fitment = await db.partFitment.findFirst({
    where: { id: req.params.fitmentId, catalogItem: { ...tenantScope(req) } },
  });
  if (!fitment) throw ApiError.notFound("Fitment not found.");

  await db.partFitment.delete({ where: { id: fitment.id } });
  res.status(204).send();
};

export const deleteCatalogItem = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const existing = await db.catalogItem.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!existing) throw ApiError.notFound("Part not found.");

  await db.$transaction(async (tx) => {
    await tx.estimateLine.updateMany({
      where: { catalogItemId: existing.id },
      data: { catalogItemId: null },
    });
    await tx.jobPartUsage.updateMany({
      where: { catalogItemId: existing.id },
      data: { catalogItemId: null },
    });
    await tx.partFitment.deleteMany({ where: { catalogItemId: existing.id } });
    await tx.catalogItem.delete({ where: { id: existing.id } });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      ...auditContext(req),
      action: "catalog.item_deleted",
      resourceType: "catalog_item",
      resourceId: existing.id,
      metadata: { partNumber: existing.partNumber, description: existing.description },
    });
  });

  res.json({ success: true });
};

export const deleteLaborRate = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const rate = await db.laborRate.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!rate) throw ApiError.notFound("Labor rate not found.");

  await db.laborRate.delete({ where: { id: rate.id } });
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    ...auditContext(req),
    action: "settings.labor_rate_deleted",
    resourceType: "labor_rate",
    resourceId: rate.id,
    metadata: { name: rate.name },
  });

  res.json({ success: true });
};

export const listAuditTrail = async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "25"), 10) || 25));
  const skip = (page - 1) * limit;

  const q = req.query.q ? String(req.query.q).trim() : "";
  const action = req.query.action ? String(req.query.action).trim() : "";
  const resourceType = req.query.resourceType ? String(req.query.resourceType).trim() : "";

  const where: any = {
    ...tenantScope(req),
  };

  if (action) {
    where.action = { contains: action };
  }
  if (resourceType) {
    where.resourceType = resourceType;
  }
  if (req.query.resourceId) {
    where.resourceId = String(req.query.resourceId);
  }
  if (req.query.actorId) {
    where.actorId = String(req.query.actorId);
  }
  if (q) {
    where.OR = [
      { action: { contains: q } },
      { resourceType: { contains: q } },
      { reason: { contains: q } },
      { actor: { firstName: { contains: q } } },
      { actor: { lastName: { contains: q } } },
      { actor: { email: { contains: q } } },
    ];
  }

  const sortOrder = req.query.sortOrder === "asc" ? ("asc" as const) : ("desc" as const);

  const [total, events] = await Promise.all([
    db.auditEvent.count({ where }),
    db.auditEvent.findMany({
      where,
      orderBy: { createdAt: sortOrder },
      skip,
      take: limit,
      include: { actor: { select: { id: true, firstName: true, lastName: true, email: true } } },
    }),
  ]);

  res.json({
    data: events,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  });
};

export const bootstrapAccounts = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const created = await db.$transaction(
    CHART_OF_ACCOUNTS.map((a) =>
      db.account.upsert({
        where: { organizationId_code: { organizationId: ctx.organizationId, code: a.code } },
        create: { ...a, organizationId: ctx.organizationId },
        update: {},
      }),
    ),
  );
  res.json({ count: created.length });
};

export const clearAllData = async (req: Request, res: Response) => {
  const ctx = auth(req);
  assertPermission(ctx.role, "settings.write");

  const body = z
    .object({
      confirm: z.string().refine((val) => val === "DELETE" || val === "DELETE ALL DATA", {
        message: "You must type 'DELETE' or 'DELETE ALL DATA' to confirm removal.",
      }),
    })
    .parse(req.body);

  const orgId = ctx.organizationId;

  await db.$transaction(async (tx) => {
    // 1. Inventory units & products
    await tx.inventoryUnit.deleteMany({ where: { organizationId: orgId } });
    await tx.inventoryProduct.deleteMany({ where: { organizationId: orgId } });

    // 2. Booking requests & Appointments
    await tx.bookingRequest.deleteMany({ where: { organizationId: orgId } });
    await tx.appointment.deleteMany({ where: { organizationId: orgId } });

    // 3. Finance & Accounting: Reconciliation, Cash Sessions, Expenses, Ledger entries
    await tx.reconciliationItem.deleteMany({ where: { organizationId: orgId } });
    await tx.journalEntry.updateMany({
      where: { organizationId: orgId },
      data: { reversesId: null },
    });
    await tx.journalLine.deleteMany({
      where: { journalEntry: { organizationId: orgId } },
    });
    await tx.journalEntry.deleteMany({ where: { organizationId: orgId } });
    await tx.expense.deleteMany({ where: { organizationId: orgId } });
    await tx.cashSession.deleteMany({ where: { organizationId: orgId } });

    // 4. Invoices, Payments, Refunds, Deposits, Credit Notes
    await tx.depositApplication.deleteMany({
      where: { deposit: { organizationId: orgId } },
    });
    await tx.paymentAllocation.deleteMany({
      where: { payment: { organizationId: orgId } },
    });
    await tx.refund.deleteMany({ where: { organizationId: orgId } });
    await tx.paymentAttempt.deleteMany({ where: { organizationId: orgId } });
    await tx.payment.deleteMany({ where: { organizationId: orgId } });
    await tx.creditNote.deleteMany({ where: { organizationId: orgId } });
    await tx.customerDeposit.deleteMany({ where: { organizationId: orgId } });
    await tx.invoiceLine.deleteMany({
      where: { invoice: { organizationId: orgId } },
    });
    await tx.invoice.deleteMany({ where: { organizationId: orgId } });

    // 5. Jobs / Repair orders, Estimates, Inspections, Tasks
    await tx.estimateApproval.deleteMany({
      where: { estimateVersion: { estimate: { organizationId: orgId } } },
    });
    await tx.estimateLine.deleteMany({
      where: { estimateVersion: { estimate: { organizationId: orgId } } },
    });
    await tx.estimateVersion.deleteMany({
      where: { estimate: { organizationId: orgId } },
    });
    await tx.estimate.deleteMany({ where: { organizationId: orgId } });

    await tx.jobPartUsage.deleteMany({
      where: { repairOrder: { organizationId: orgId } },
    });
    await tx.timeEntry.deleteMany({
      where: { repairOrder: { organizationId: orgId } },
    });
    await tx.repairTask.deleteMany({
      where: { repairOrder: { organizationId: orgId } },
    });
    await tx.inspectionItem.deleteMany({
      where: { inspection: { organizationId: orgId } },
    });
    await tx.inspection.deleteMany({ where: { organizationId: orgId } });
    await tx.repairOrder.deleteMany({ where: { organizationId: orgId } });

    // 6. Vehicles and Customers
    await tx.mileageReading.deleteMany({
      where: { vehicle: { organizationId: orgId } },
    });
    await tx.customerVehicle.deleteMany({
      where: { customer: { organizationId: orgId } },
    });
    await tx.vehicle.deleteMany({ where: { organizationId: orgId } });
    await tx.customer.deleteMany({ where: { organizationId: orgId } });

    // 7. Parts catalog (fitments cascade) and labor rates
    await tx.catalogItem.deleteMany({ where: { organizationId: orgId } });
    await tx.laborRate.deleteMany({ where: { organizationId: orgId } });

    // 8. Staff shift clock punches & time clock history
    await tx.shiftClockEntry.deleteMany({ where: { organizationId: orgId } });

    // NOTE: Owner user accounts, memberships, locations, organization settings,
    // and full Audit Trail history are strictly preserved and NEVER deleted.
  });

  await recordAudit(db, {
    organizationId: ctx.organizationId,
    ...auditContext(req),
    action: "data.reset_all",
    resourceType: "organization",
    resourceId: ctx.organizationId,
    reason: "Owner requested operational data reset. Owner login and audit history preserved.",
  });

  res.json({
    success: true,
    message: "All operational records have been removed. Owner account and audit history are safely preserved.",
  });
};

