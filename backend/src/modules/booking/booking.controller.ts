import { type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../../db.js";
import { ApiError } from "../../middlewares/error.middleware.js";
import { queryEnum } from "../../utils/query.js";
import { auth, resolveLocationId, tenantScope } from "../../middlewares/auth.middleware.js";
import { auditContext, recordAudit } from "../../lib/audit.js";

const STATUSES = ["NEW", "CONTACTED", "BOOKED", "CLOSED"] as const;

export const listBookingRequests = async (req: Request, res: Response) => {
  const status = queryEnum(req.query.status, STATUSES, "status");
  const requests = await db.bookingRequest.findMany({
    where: {
      ...tenantScope(req),
      ...(status ? { status } : { status: { in: ["NEW", "CONTACTED"] } }),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      vehicle: true,
      service: true,
      preferredDate: true,
      preferredTime: true,
      notes: true,
      status: true,
      createdAt: true,
    },
  });
  res.json({ data: requests });
};

export const updateBookingStatus = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const { status } = z.object({ status: z.enum(STATUSES) }).parse(req.body);
  const found = await db.bookingRequest.findFirst({
    where: { id: req.params.id, ...tenantScope(req) },
  });
  if (!found) throw ApiError.notFound("Request not found.");
  const updated = await db.bookingRequest.update({
    where: { id: found.id },
    data: { status },
  });
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    ...auditContext(req),
    action: "booking.status_changed",
    resourceType: "booking_request",
    resourceId: found.id,
    metadata: { from: found.status, to: status },
  });
  res.json(updated);
};

export const convertBookingToAppointment = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const requestId = req.params.id;

  const booking = await db.bookingRequest.findFirst({
    where: { id: requestId, ...tenantScope(req) },
  });
  if (!booking) throw ApiError.notFound("Booking request not found.");

  const locationId = await resolveLocationId(req);

  // Parse name into firstName & lastName
  const nameParts = booking.name.trim().split(/\s+/);
  const firstName = nameParts[0] || "Customer";
  const lastName = nameParts.slice(1).join(" ") || "Guest";
  const cleanPhone = booking.phone.trim();

  // Find or create Customer by phone
  let customer = await db.customer.findFirst({
    where: {
      organizationId: ctx.organizationId,
      phone: cleanPhone,
    },
  });

  if (!customer) {
    customer = await db.customer.create({
      data: {
        organizationId: ctx.organizationId,
        firstName,
        lastName,
        phone: cleanPhone,
        email: booking.email || null,
        notes: booking.notes ? `Website booking notes: ${booking.notes}` : null,
      },
    });
  }

  // Find or create Vehicle from text like "2021 BMW M5"
  let year: number | null = null;
  let make: string | null = null;
  let model: string | null = null;

  if (booking.vehicle) {
    const vehText = booking.vehicle.trim();
    const yearMatch = vehText.match(/\b(19\d{2}|20\d{2})\b/);
    if (yearMatch) {
      year = parseInt(yearMatch[1], 10);
    }
    const remaining = vehText.replace(/\b(19\d{2}|20\d{2})\b/, "").trim();
    const parts = remaining.split(/\s+/);
    if (parts.length > 0 && parts[0]) {
      make = parts[0];
      model = parts.slice(1).join(" ") || null;
    } else {
      make = vehText;
    }
  }

  let vehicle = await db.vehicle.findFirst({
    where: {
      organizationId: ctx.organizationId,
      owners: { some: { customerId: customer.id } },
      ...(make ? { make: { equals: make } } : {}),
      ...(model ? { model: { equals: model } } : {}),
    },
  });

  if (!vehicle) {
    vehicle = await db.vehicle.create({
      data: {
        organizationId: ctx.organizationId,
        year: year || null,
        make: make || "Vehicle",
        model: model || null,
      },
    });

    await db.customerVehicle.create({
      data: {
        customerId: customer.id,
        vehicleId: vehicle.id,
        isPrimary: true,
      },
    });
  }

  // Calculate scheduled date/time
  let scheduledFor = booking.preferredDate ? new Date(booking.preferredDate) : new Date();
  const timeStr = (booking.preferredTime || "").toLowerCase();
  if (timeStr.includes("morning")) {
    scheduledFor.setHours(9, 0, 0, 0);
  } else if (timeStr.includes("afternoon")) {
    scheduledFor.setHours(14, 0, 0, 0);
  } else if (timeStr.includes("evening")) {
    scheduledFor.setHours(16, 30, 0, 0);
  } else {
    if (scheduledFor.getHours() === 0) {
      scheduledFor.setHours(9, 0, 0, 0);
    }
  }

  // If in the past, adjust to upcoming hour
  if (scheduledFor.getTime() < Date.now()) {
    scheduledFor = new Date(Date.now() + 1000 * 60 * 60 * 2);
  }

  const concernText = [booking.service, booking.notes].filter(Boolean).join(" - ");

  const appointment = await db.appointment.create({
    data: {
      organizationId: ctx.organizationId,
      locationId,
      customerId: customer.id,
      vehicleId: vehicle.id,
      scheduledFor,
      estimatedHours: 1.0,
      concern: concernText || "Service requested via website",
      requestedWork: booking.service,
    },
    include: {
      customer: true,
      vehicle: true,
    },
  });

  // Mark request as BOOKED
  await db.bookingRequest.update({
    where: { id: booking.id },
    data: { status: "BOOKED" },
  });

  await recordAudit(db, {
    organizationId: ctx.organizationId,
    ...auditContext(req),
    action: "booking.converted_to_appointment",
    resourceType: "booking_request",
    resourceId: booking.id,
    metadata: { appointmentId: appointment.id, customerId: customer.id, vehicleId: vehicle.id },
  });

  res.status(201).json({
    appointment,
    customer,
    vehicle,
    message: "Appointment successfully created from website request!",
  });
};
