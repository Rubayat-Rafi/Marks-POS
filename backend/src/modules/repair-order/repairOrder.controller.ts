import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../db.js";
import { ApiError } from "../../middlewares/error.middleware.js";
import { queryEnum, queryUuid } from "../../utils/query.js";
import { auth, resolveLocationId, tenantScope } from "../../middlewares/auth.middleware.js";
import { can } from "../../middlewares/rbac.middleware.js";
import { auditContext, recordAudit } from "../../lib/audit.js";
import { nextNumber } from "../../lib/sequences.js";
import { enqueueOutbox, OUTBOX_EVENTS } from "../../lib/outbox.js";
import { decimalToNumber } from "../../lib/money.js";
import { withPhotoKeys } from "../../lib/json.js";
import { assertRepairOrderTransition, REPAIR_ORDER_LANES } from "../../domain/states.js";
import { grossMarginPct } from "../../domain/pricing.js";
import { deleteRepairOrderTx } from "../../domain/deletion.js";

export async function getWorkBoard(req: Request, res: Response) {
  const ctx = auth(req);
  const orders = await db.repairOrder.findMany({
    where: {
      ...tenantScope(req),
      ...(ctx.locationId ? { locationId: ctx.locationId } : {}),
      status: { in: REPAIR_ORDER_LANES },
    },
    orderBy: [{ promisedAt: "asc" }, { createdAt: "asc" }],
    include: {
      customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
      vehicle: { select: { id: true, year: true, make: true, model: true, plate: true } },
      tasks: { select: { id: true, status: true, assignedToId: true } },
      estimates: {
        select: { id: true, status: true, number: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  res.json({
    lanes: REPAIR_ORDER_LANES.map((status) => ({
      status,
      orders: orders.filter((o) => o.status === status),
    })),
  });
}

export async function listRepairOrders(req: Request, res: Response) {
  const orders = await db.repairOrder.findMany({
    where: {
      ...tenantScope(req),
      ...(req.query.status
        ? {
            status: queryEnum(
              req.query.status,
              ["SCHEDULED", "CHECKED_IN", "DIAGNOSING", "AWAITING_APPROVAL", "AWAITING_PARTS", "IN_PROGRESS", "QUALITY_CHECK", "READY", "DELIVERED", "CANCELLED"] as const,
              "status",
            ),
          }
        : {}),
      ...(req.query.customerId ? { customerId: queryUuid(req.query.customerId, "customerId") } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { customer: true, vehicle: true },
  });
  res.json({ data: orders });
}

export async function getRepairOrder(req: Request, res: Response) {
  const ctx = auth(req);
  const order = await db.repairOrder.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: {
      customer: true,
      vehicle: { include: { mileageReadings: { orderBy: { observedAt: "desc" }, take: 1 } } },
      location: true,
      tasks: { orderBy: { sortOrder: "asc" } },
      timeEntries: { include: { technician: { select: { id: true, firstName: true, lastName: true } } } },
      partUsages: true,
      inspections: { include: { items: { orderBy: { sortOrder: "asc" } } } },
      estimates: {
        orderBy: { createdAt: "desc" },
        include: {
          versions: {
            orderBy: { version: "desc" },
            include: { lines: { orderBy: { sortOrder: "asc" } }, approvals: true },
          },
        },
      },
      invoices: { include: { lines: true, allocations: true } },
    },
  });
  if (!order) throw ApiError.notFound("Repair order not found.");

  const showCosts = can(ctx.role, "reports.costs");
  const netSales = order.invoices
    .filter((i) => i.status !== "VOID" && i.status !== "DRAFT")
    .reduce((sum, i) => sum + i.subtotal - i.discountTotal, 0);
  const partsCost = order.partUsages
    .filter((p) => !p.returned)
    .reduce((sum, p) => sum + Math.round(decimalToNumber(p.quantity) * p.unitCost), 0);
  const laborCost = order.invoices
    .flatMap((i) => i.lines)
    .filter((l) => l.lineType === "LABOR")
    .reduce((sum, l) => sum + Math.round(decimalToNumber(l.quantity) * l.unitCost), 0);

  res.json({
    ...order,
    inspections: order.inspections.map(withPhotoKeys),
    partUsages: showCosts ? order.partUsages : order.partUsages.map(({ unitCost, ...p }) => p),
    margin: showCosts
      ? {
          netSales,
          directCost: partsCost + laborCost,
          grossProfit: netSales - (partsCost + laborCost),
          grossMarginPct: grossMarginPct(netSales, partsCost + laborCost),
          provisional: order.costsProvisional,
        }
      : null,
  });
}

export async function createRepairOrder(req: Request, res: Response) {
  const ctx = auth(req);
  const body = z
    .object({
      customerId: z.string().uuid(),
      vehicleId: z.string().uuid(),
      locationId: z.string().uuid().optional(),
      concern: z.string().min(1, "Describe the concern."),
      mileageIn: z.number().int().min(0).optional(),
      promisedAt: z.coerce.date().optional(),
    })
    .parse(req.body);

  const locationId = await resolveLocationId(req, body.locationId);
  const [customer, vehicle] = await Promise.all([
    db.customer.findFirst({ where: { id: body.customerId, ...tenantScope(req) } }),
    db.vehicle.findFirst({ where: { id: body.vehicleId, ...tenantScope(req) } }),
  ]);
  if (!customer) throw ApiError.notFound("Customer not found.");
  if (!vehicle) throw ApiError.notFound("Vehicle not found.");

  const order = await db.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.organizationId, "repair_order");
    const created = await tx.repairOrder.create({
      data: {
        organizationId: ctx.organizationId,
        locationId,
        customerId: body.customerId,
        vehicleId: body.vehicleId,
        number,
        status: "CHECKED_IN",
        concern: body.concern,
        mileageIn: body.mileageIn,
        promisedAt: body.promisedAt,
        checkedInAt: new Date(),
      },
    });
    if (body.mileageIn !== undefined) {
      await tx.mileageReading.create({
        data: { vehicleId: body.vehicleId, miles: body.mileageIn, source: "check_in" },
      });
    }
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      ...auditContext(req),
      action: "repair_order.created",
      resourceType: "repair_order",
      resourceId: created.id,
    });
    return created;
  });

  res.status(201).json(order);
}

export async function updateRepairOrderStatus(req: Request, res: Response) {
  const ctx = auth(req);
  const { status, expectedVersion } = z
    .object({
      status: z.enum([
        "SCHEDULED",
        "CHECKED_IN",
        "DIAGNOSING",
        "AWAITING_APPROVAL",
        "AWAITING_PARTS",
        "IN_PROGRESS",
        "QUALITY_CHECK",
        "READY",
        "DELIVERED",
        "CANCELLED",
      ]),
      expectedVersion: z.number().int().optional(),
    })
    .parse(req.body);

  const order = await db.repairOrder.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: { invoices: true },
  });
  if (!order) throw ApiError.notFound("Repair order not found.");

  if (expectedVersion !== undefined && expectedVersion !== order.version) {
    throw ApiError.conflict("Someone else changed this job. Reload and try again.");
  }
  assertRepairOrderTransition(order.status, status);

  const warnings: string[] = [];
  if (status === "CANCELLED") {
    const settled = order.invoices.filter((i) => i.amountPaid > 0);
    if (settled.length > 0) {
      warnings.push(
        `${settled.length} invoice(s) on this job have payments. Cancelling the job does not refund them; issue a refund or credit separately.`,
      );
    }
  }

  const updated = await db.$transaction(async (tx) => {
    const result = await tx.repairOrder.update({
      where: { id: order.id },
      data: {
        status,
        version: { increment: 1 },
        readyAt: status === "READY" ? new Date() : undefined,
        deliveredAt: status === "DELIVERED" ? new Date() : undefined,
      },
    });
    if (status === "READY") {
      await enqueueOutbox(tx, ctx.organizationId, OUTBOX_EVENTS.JOB_READY, {
        repairOrderId: order.id,
        number: order.number,
        customerId: order.customerId,
      });
    }
    if (status === "DELIVERED") {
      await enqueueOutbox(tx, ctx.organizationId, OUTBOX_EVENTS.JOB_DELIVERED, {
        repairOrderId: order.id,
        number: order.number,
      });
    }
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      ...auditContext(req),
      action: `repair_order.status.${status.toLowerCase()}`,
      resourceType: "repair_order",
      resourceId: order.id,
      metadata: { from: order.status, to: status },
    });
    return result;
  });

  res.json({ ...updated, warnings });
}

export async function addTask(req: Request, res: Response) {
  const body = z
    .object({
      description: z.string().min(1),
      assignedToId: z.string().uuid().optional().nullable(),
      estimatedHours: z.number().min(0).default(0),
    })
    .parse(req.body);

  const order = await db.repairOrder.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: { tasks: true },
  });
  if (!order) throw ApiError.notFound("Repair order not found.");

  const task = await db.repairTask.create({
    data: { ...body, repairOrderId: order.id, sortOrder: order.tasks.length },
  });
  res.status(201).json(task);
}

export async function updateTask(req: Request, res: Response) {
  const ctx = auth(req);
  const body = z
    .object({
      status: z.enum(["PENDING", "IN_PROGRESS", "BLOCKED", "DONE"]).optional(),
      assignedToId: z.string().uuid().nullable().optional(),
      description: z.string().optional(),
    })
    .parse(req.body);

  const task = await db.repairTask.findFirst({
    where: { id: req.params.taskId, repairOrder: { ...tenantScope(req) } },
  });
  if (!task) throw ApiError.notFound("Task not found.");

  if (ctx.role === "TECHNICIAN" && task.assignedToId && task.assignedToId !== ctx.userId) {
    throw ApiError.forbidden("That task is assigned to someone else.");
  }

  res.json(await db.repairTask.update({ where: { id: task.id }, data: body }));
}

export async function addTimeEntry(req: Request, res: Response) {
  const ctx = auth(req);
  const body = z
    .object({
      technicianId: z.string().uuid().optional(),
      startedAt: z.coerce.date(),
      endedAt: z.coerce.date().optional(),
      note: z.string().optional(),
    })
    .parse(req.body);

  const order = await db.repairOrder.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!order) throw ApiError.notFound("Repair order not found.");

  const technicianId =
    ctx.role === "TECHNICIAN" ? ctx.userId : (body.technicianId ?? ctx.userId);
  const workedHours = body.endedAt
    ? (body.endedAt.getTime() - body.startedAt.getTime()) / 3_600_000
    : 0;
  if (workedHours < 0) {
    throw ApiError.unprocessable("The end time is before the start time.");
  }

  const entry = await db.timeEntry.create({
    data: {
      repairOrderId: order.id,
      technicianId,
      startedAt: body.startedAt,
      endedAt: body.endedAt,
      workedHours: workedHours.toFixed(2),
      note: body.note,
    },
  });
  res.status(201).json(entry);
}

export async function addPartUsage(req: Request, res: Response) {
  const ctx = auth(req);
  const body = z
    .object({
      catalogItemId: z.string().uuid().optional().nullable(),
      supplierId: z.string().uuid().optional().nullable(),
      partNumber: z.string().min(1),
      description: z.string().min(1),
      quantity: z.number().positive(),
      unitCost: z.number().int().min(0),
      unitPrice: z.number().int().min(0),
    })
    .parse(req.body);

  const order = await db.repairOrder.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!order) throw ApiError.notFound("Repair order not found.");

  if (body.catalogItemId) {
    const item = await db.catalogItem.findFirst({
      where: { id: body.catalogItemId, ...tenantScope(req) },
      select: { id: true },
    });
    if (!item) throw ApiError.notFound("Part not found in this shop's catalog.");
  }
  if (body.supplierId) {
    const supplier = await db.supplier.findFirst({
      where: { id: body.supplierId, ...tenantScope(req) },
      select: { id: true },
    });
    if (!supplier) throw ApiError.notFound("Supplier not found.");
  }

  const usage = await db.$transaction(async (tx) => {
    const created = await tx.jobPartUsage.create({
      data: { ...body, repairOrderId: order.id },
    });
    if (body.catalogItemId) {
      await tx.catalogItem.update({
        where: { id: body.catalogItemId },
        data: { onHand: { decrement: body.quantity } },
      });
    }
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      ...auditContext(req),
      action: "job.part_consumed",
      resourceType: "repair_order",
      resourceId: order.id,
      metadata: { partNumber: body.partNumber, quantity: body.quantity },
    });
    return created;
  });

  res.status(201).json(usage);
}

export async function returnPartUsage(req: Request, res: Response) {
  const usage = await db.jobPartUsage.findFirst({
    where: { id: req.params.usageId, repairOrder: { ...tenantScope(req) } },
  });
  if (!usage) throw ApiError.notFound("Part usage not found.");
  if (usage.returned) throw ApiError.conflict("That part is already marked returned.");

  const updated = await db.$transaction(async (tx) => {
    const result = await tx.jobPartUsage.update({
      where: { id: usage.id },
      data: { returned: true },
    });
    if (usage.catalogItemId) {
      await tx.catalogItem.update({
        where: { id: usage.catalogItemId },
        data: { onHand: { increment: usage.quantity } },
      });
    }
    return result;
  });

  res.json(updated);
}

export async function addInspection(req: Request, res: Response) {
  const ctx = auth(req);
  const body = z
    .object({
      title: z.string().default("Multi-point inspection"),
      notes: z.string().optional(),
      items: z
        .array(
          z.object({
            category: z.string(),
            label: z.string(),
            result: z.enum(["OK", "ADVISE", "URGENT", "NOT_CHECKED"]).default("NOT_CHECKED"),
            note: z.string().optional(),
            photoKeys: z.array(z.string()).default([]),
          }),
        )
        .default([]),
    })
    .parse(req.body);

  const order = await db.repairOrder.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!order) throw ApiError.notFound("Repair order not found.");

  const inspection = await db.inspection.create({
    data: {
      organizationId: ctx.organizationId,
      vehicleId: order.vehicleId,
      repairOrderId: order.id,
      performedById: ctx.userId,
      title: body.title,
      notes: body.notes,
      completedAt: new Date(),
      items: { create: body.items.map((item, i) => ({ ...item, sortOrder: i })) },
    },
    include: { items: true },
  });

  res.status(201).json(withPhotoKeys(inspection));
}

export async function deleteRepairOrder(req: Request, res: Response) {
  const ctx = auth(req);
  const order = await db.repairOrder.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!order) throw ApiError.notFound("Repair order not found.");

  await db.$transaction(async (tx) => {
    await deleteRepairOrderTx(tx, ctx.organizationId, order.id);
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      ...auditContext(req),
      action: "repair_order.deleted",
      resourceType: "repair_order",
      resourceId: order.id,
      metadata: { number: order.number, status: order.status },
    });
  });

  res.json({ success: true });
}

export async function deleteTask(req: Request, res: Response) {
  const task = await db.repairTask.findFirst({
    where: { id: req.params.taskId, repairOrder: { ...tenantScope(req) } },
  });
  if (!task) throw ApiError.notFound("Task not found.");

  await db.repairTask.delete({ where: { id: task.id } });
  res.json({ success: true });
}

export async function deleteTimeEntry(req: Request, res: Response) {
  const entry = await db.timeEntry.findFirst({
    where: { id: req.params.timeEntryId, repairOrder: { ...tenantScope(req) } },
  });
  if (!entry) throw ApiError.notFound("Time entry not found.");

  await db.timeEntry.delete({ where: { id: entry.id } });
  res.json({ success: true });
}

export async function deletePartUsage(req: Request, res: Response) {
  const ctx = auth(req);
  const usage = await db.jobPartUsage.findFirst({
    where: { id: req.params.usageId, repairOrder: { ...tenantScope(req) } },
  });
  if (!usage) throw ApiError.notFound("Part usage not found.");

  await db.$transaction(async (tx) => {
    if (usage.catalogItemId && !usage.returned) {
      await tx.catalogItem.updateMany({
        where: { id: usage.catalogItemId, organizationId: ctx.organizationId },
        data: { onHand: { increment: usage.quantity } },
      });
    }
    await tx.jobPartUsage.delete({ where: { id: usage.id } });
  });

  res.json({ success: true });
}

export async function deleteInspection(req: Request, res: Response) {
  const inspection = await db.inspection.findFirst({
    where: { id: req.params.inspectionId, ...tenantScope(req) },
  });
  if (!inspection) throw ApiError.notFound("Inspection not found.");

  await db.$transaction(async (tx) => {
    await tx.inspectionItem.deleteMany({ where: { inspectionId: inspection.id } });
    await tx.inspection.delete({ where: { id: inspection.id } });
  });

  res.json({ success: true });
}
