import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../../db.js";
import { ApiError } from "../../middlewares/error.middleware.js";
import { queryDate, queryEnum } from "../../utils/query.js";
import { auth, resolveLocationId, tenantScope } from "../../middlewares/auth.middleware.js";
import { auditContext, recordAudit } from "../../lib/audit.js";
import { nextNumber } from "../../lib/sequences.js";

export const appointmentSchema = z.object({
  locationId: z.string().uuid().optional(),
  customerId: z.string().uuid(),
  vehicleId: z.string().uuid(),
  scheduledFor: z.coerce.date(),
  estimatedHours: z.number().min(0).max(100).default(1),
  concern: z.string().min(1, "Describe the concern."),
  requestedWork: z.string().optional().nullable(),
  mileageIn: z.number().int().min(0).optional().nullable(),
});

export async function listAppointments(req: Request, res: Response) {
  const from = queryDate(req.query.from, "from") ?? new Date();
  const to = queryDate(req.query.to, "to") ?? new Date(from.getTime() + 1000 * 60 * 60 * 24 * 7);
  const status = queryEnum(req.query.status, ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "NO_SHOW", "CANCELLED", "CONVERTED"] as const, "status");

  const ctx = auth(req);
  const appointments = await db.appointment.findMany({
    where: {
      ...tenantScope(req),
      ...(ctx.locationId ? { locationId: ctx.locationId } : {}),
      scheduledFor: { gte: from, lte: to },
      ...(status ? { status } : {}),
    },
    orderBy: { scheduledFor: "asc" },
    include: {
      customer: true,
      vehicle: true,
      repairOrder: { select: { id: true, number: true, status: true } },
    },
  });

  res.json({ data: appointments });
}

export async function createAppointment(req: Request, res: Response) {
  const ctx = auth(req);
  const body = appointmentSchema.parse(req.body);
  const locationId = await resolveLocationId(req, body.locationId);

  const [customer, vehicle] = await Promise.all([
    db.customer.findFirst({ where: { id: body.customerId, ...tenantScope(req) } }),
    db.vehicle.findFirst({ where: { id: body.vehicleId, ...tenantScope(req) } }),
  ]);
  if (!customer) throw ApiError.notFound("Customer not found.");
  if (!vehicle) throw ApiError.notFound("Vehicle not found.");

  const appointment = await db.appointment.create({
    data: {
      organizationId: ctx.organizationId,
      locationId,
      customerId: body.customerId,
      vehicleId: body.vehicleId,
      scheduledFor: body.scheduledFor,
      estimatedHours: body.estimatedHours,
      concern: body.concern,
      requestedWork: body.requestedWork,
      mileageIn: body.mileageIn,
    },
    include: { customer: true, vehicle: true },
  });

  await recordAudit(db, {
    organizationId: ctx.organizationId,
    ...auditContext(req),
    action: "appointment.created",
    resourceType: "appointment",
    resourceId: appointment.id,
  });
  res.status(201).json(appointment);
}

export async function updateAppointment(req: Request, res: Response) {
  const body = appointmentSchema.partial().parse(req.body);
  const { status } = z
    .object({ status: z.enum(["SCHEDULED", "CONFIRMED", "NO_SHOW", "CANCELLED"]).optional() })
    .parse(req.body ?? {});

  const existing = await db.appointment.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!existing) throw ApiError.notFound("Appointment not found.");
  if (existing.status === "CONVERTED") {
    throw ApiError.conflict("This appointment is already a repair order.");
  }

  const appointment = await db.appointment.update({
    where: { id: existing.id },
    data: {
      scheduledFor: body.scheduledFor,
      estimatedHours: body.estimatedHours,
      concern: body.concern,
      requestedWork: body.requestedWork,
      mileageIn: body.mileageIn,
      status,
    },
  });
  res.json(appointment);
}

export async function checkInAppointment(req: Request, res: Response) {
  const ctx = auth(req);
  const body = z
    .object({
      mileageIn: z.number().int().min(0).optional(),
      promisedAt: z.coerce.date().optional(),
    })
    .parse(req.body ?? {});

  const appointment = await db.appointment.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
    include: { repairOrder: true },
  });
  if (!appointment) throw ApiError.notFound("Appointment not found.");
  if (appointment.repairOrder) {
    throw ApiError.conflict(
      `This appointment is already repair order ${appointment.repairOrder.number}.`,
    );
  }

  const repairOrder = await db.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.organizationId, "repair_order");
    const mileageIn = body.mileageIn ?? appointment.mileageIn ?? null;

    const ro = await tx.repairOrder.create({
      data: {
        organizationId: ctx.organizationId,
        locationId: appointment.locationId,
        customerId: appointment.customerId,
        vehicleId: appointment.vehicleId,
        appointmentId: appointment.id,
        number,
        status: "CHECKED_IN",
        concern: appointment.concern,
        mileageIn,
        promisedAt: body.promisedAt ?? null,
        checkedInAt: new Date(),
      },
    });

    if (mileageIn !== null) {
      await tx.mileageReading.create({
        data: { vehicleId: appointment.vehicleId, miles: mileageIn, source: "check_in" },
      });
    }

    await tx.appointment.update({
      where: { id: appointment.id },
      data: { status: "CONVERTED" },
    });

    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      ...auditContext(req),
      action: "repair_order.checked_in",
      resourceType: "repair_order",
      resourceId: ro.id,
      metadata: { appointmentId: appointment.id, number },
    });

    return ro;
  });

  res.status(201).json(repairOrder);
}

export async function deleteAppointment(req: Request, res: Response) {
  const ctx = auth(req);
  const existing = await db.appointment.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!existing) throw ApiError.notFound("Appointment not found.");

  await db.$transaction(async (tx) => {
    await tx.repairOrder.updateMany({
      where: { appointmentId: existing.id, organizationId: ctx.organizationId },
      data: { appointmentId: null },
    });
    await tx.appointment.delete({ where: { id: existing.id } });
    await recordAudit(tx, {
      organizationId: ctx.organizationId,
      ...auditContext(req),
      action: "appointment.deleted",
      resourceType: "appointment",
      resourceId: existing.id,
    });
  });

  res.json({ success: true });
}
