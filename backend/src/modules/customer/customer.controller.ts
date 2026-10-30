import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../db.js";
import { ApiError } from "../../middlewares/error.middleware.js";
import { auth, tenantScope } from "../../middlewares/auth.middleware.js";
import { auditContext, recordAudit } from "../../lib/audit.js";
import { deleteCustomerTx } from "../../domain/deletion.js";

export const customerSchema = z.object({
  firstName: z.string().min(1, "First name is required."),
  lastName: z.string().min(1, "Last name is required."),
  companyName: z.string().optional().nullable(),
  email: z.string().email("Enter a valid email address.").optional().or(z.literal("")),
  phone: z.string().optional().nullable(),
  addressLine1: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  allowsMarketing: z.boolean().optional(),
  allowsSms: z.boolean().optional(),
  taxExempt: z.boolean().optional(),
});

export async function listCustomers(req: Request, res: Response) {
  const q = String(req.query.q ?? "").trim();
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "25"), 10) || 25));
  const skip = (page - 1) * limit;
  const sortOrder = req.query.sortOrder === "asc" ? "asc" : "desc";
  const sortBy = req.query.sortBy === "name" ? "name" : "createdAt";

  const where = {
    ...tenantScope(req),
    archivedAt: null,
    ...(q
      ? {
          OR: [
            { firstName: { contains: q } },
            { lastName: { contains: q } },
            { companyName: { contains: q } },
            { email: { contains: q } },
            { phone: { contains: q } },
          ],
        }
      : {}),
  };

  const orderBy =
    sortBy === "name"
      ? [{ lastName: sortOrder as "asc" | "desc" }, { firstName: sortOrder as "asc" | "desc" }]
      : { createdAt: sortOrder as "asc" | "desc" };

  const [total, customers] = await Promise.all([
    db.customer.count({ where }),
    db.customer.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        _count: { select: { vehicles: true, repairOrders: true } },
      },
    }),
  ]);

  res.json({
    data: customers,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  });
}

export async function getCustomer(req: Request, res: Response) {
  const customer = await db.customer.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: {
      vehicles: { include: { vehicle: true } },
      repairOrders: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { vehicle: true },
      },
      invoices: { orderBy: { createdAt: "desc" }, take: 20 },
      deposits: { where: { amount: { gt: 0 } } },
    },
  });
  if (!customer) throw ApiError.notFound("Customer not found.");

  const creditAvailable = customer.deposits.reduce(
    (sum, d) => sum + (d.amount - d.amountApplied),
    0,
  );
  const outstanding = customer.invoices
    .filter((i) => i.status === "ISSUED" || i.status === "PARTLY_PAID")
    .reduce((sum, i) => sum + (i.total - i.amountPaid - i.amountCredited), 0);

  res.json({ ...customer, creditAvailable, outstanding });
}

export async function createCustomer(req: Request, res: Response) {
  const ctx = auth(req);
  const body = customerSchema.parse(req.body);

  if (body.phone || body.email) {
    const duplicate = await db.customer.findFirst({
      where: {
        ...tenantScope(req),
        archivedAt: null,
        OR: [
          ...(body.phone ? [{ phone: body.phone }] : []),
          ...(body.email ? [{ email: body.email }] : []),
        ],
      },
    });
    if (duplicate) {
      throw ApiError.conflict(
        `${duplicate.firstName} ${duplicate.lastName} already has that phone or email.`,
      );
    }
  }

  const customer = await db.customer.create({
    data: {
      organizationId: ctx.organizationId,
      ...body,
      email: body.email || null,
    },
  });
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    ...auditContext(req),
    action: "customer.created",
    resourceType: "customer",
    resourceId: customer.id,
  });

  res.status(201).json(customer);
}

export async function updateCustomer(req: Request, res: Response) {
  const ctx = auth(req);
  const body = customerSchema.partial().parse(req.body);

  const existing = await db.customer.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!existing) throw ApiError.notFound("Customer not found.");

  const customer = await db.customer.update({
    where: { id: existing.id },
    data: { ...body, email: body.email === "" ? null : body.email },
  });
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    ...auditContext(req),
    action: "customer.updated",
    resourceType: "customer",
    resourceId: customer.id,
    metadata: { changed: Object.keys(body) },
  });

  res.json(customer);
}

export async function archiveCustomer(req: Request, res: Response) {
  const ctx = auth(req);
  const existing = await db.customer.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: { invoices: { where: { status: { in: ["ISSUED", "PARTLY_PAID"] } } } },
  });
  if (!existing) throw ApiError.notFound("Customer not found.");

  if (existing.invoices.length > 0) {
    throw ApiError.conflict(
      "This customer still has unpaid invoices. Settle or credit them first.",
    );
  }

  const customer = await db.customer.update({
    where: { id: existing.id },
    data: { archivedAt: new Date() },
  });
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    ...auditContext(req),
    action: "customer.archived",
    resourceType: "customer",
    resourceId: customer.id,
    reason: String(req.body?.reason ?? ""),
  });

  res.json(customer);
}

export async function deleteCustomer(req: Request, res: Response) {
  const ctx = auth(req);
  const existing = await db.customer.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!existing) throw ApiError.notFound("Customer not found.");

  await db.$transaction(async (tx) => {
    await deleteCustomerTx(tx, ctx.organizationId, existing.id);
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      ...auditContext(req),
      action: "customer.deleted",
      resourceType: "customer",
      resourceId: existing.id,
      metadata: { name: `${existing.firstName} ${existing.lastName}` },
    });
  });

  res.json({ success: true });
}
