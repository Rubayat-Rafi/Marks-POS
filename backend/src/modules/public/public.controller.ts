import { type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../../db.js";
import { env } from "../../env.js";
import { ApiError } from "../../middlewares/error.middleware.js";
import { resolveAttempt } from "../../domain/payments.js";

async function publicShop() {
  const org = await db.organization.findUnique({
    where: { publicSlug: env.publicShopSlug },
    include: { locations: { where: { isActive: true }, orderBy: { createdAt: "asc" }, take: 1 } },
  });
  if (!org) throw ApiError.notFound("The shop website is not set up yet.");
  return { org, location: org.locations[0] ?? null };
}

const digits = (value?: string | null) => (value ?? "").replace(/\D/g, "");

export const getPublicShop = async (_req: Request, res: Response) => {
  const { org, location } = await publicShop();
  res.json({
    name: org.name,
    legalName: org.legalName,
    phone: location?.phone ?? null,
    address: location
      ? {
          line1: location.addressLine1,
          city: location.city,
          state: location.state,
          postalCode: location.postalCode,
        }
      : null,
  });
};

export const createPublicBooking = async (req: Request, res: Response) => {
  const body = z
    .object({
      name: z.string().trim().min(2, "Enter your name.").max(100),
      phone: z
        .string()
        .trim()
        .max(30)
        .refine((p) => digits(p).length >= 10, "Enter a 10-digit phone number."),
      email: z.string().trim().email("Enter a valid email.").max(254).optional().or(z.literal("")),
      vehicle: z.string().trim().max(120).optional(),
      service: z.string().trim().min(2, "Pick a service.").max(120),
      preferredDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .or(z.literal("")),
      preferredTime: z.string().trim().max(40).optional(),
      notes: z.string().trim().max(1000).optional(),
      website: z.string().max(200).optional(),
    })
    .parse(req.body);

  if (body.website) {
    res.status(201).json({ ok: true });
    return;
  }

  let preferredDate: Date | null = null;
  if (body.preferredDate) {
    preferredDate = new Date(`${body.preferredDate}T12:00:00Z`);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (preferredDate < today) {
      throw ApiError.unprocessable("Pick today or a later date.", { preferredDate: "In the past." });
    }
  }

  const { org } = await publicShop();
  await db.bookingRequest.create({
    data: {
      organizationId: org.id,
      name: body.name,
      phone: body.phone,
      email: body.email || null,
      vehicle: body.vehicle || null,
      service: body.service,
      preferredDate,
      preferredTime: body.preferredTime || null,
      notes: body.notes || null,
      ip: req.ip ?? null,
    },
  });
  res.status(201).json({ ok: true });
};

export const lookupEstimate = async (req: Request, res: Response) => {
  const body = z
    .object({
      estimateNumber: z.string().trim().min(3).max(30),
      phone: z.string().trim().max(30),
    })
    .parse(req.body);

  const notFound = ApiError.notFound(
    "We could not find an estimate with that number and phone number. Check both, or call the shop.",
  );
  const phone = digits(body.phone).slice(-10);
  if (phone.length < 10) throw notFound;

  const { org } = await publicShop();
  const raw = body.estimateNumber.toUpperCase().replace(/\s+/g, "");
  const number = /^\d+$/.test(raw) ? `EST-${raw}` : raw;

  const estimate = await db.estimate.findFirst({
    where: { organizationId: org.id, number },
    include: {
      customer: { select: { phone: true, firstName: true } },
      vehicle: { select: { year: true, make: true, model: true } },
      versions: { orderBy: { version: "desc" }, take: 1 },
    },
  });
  if (!estimate || digits(estimate.customer.phone).slice(-10) !== phone) throw notFound;

  const version = estimate.versions[0];
  const linkLive =
    version?.approvalToken &&
    (!version.approvalTokenExpiresAt || version.approvalTokenExpiresAt.getTime() > Date.now());

  res.json({
    number: estimate.number,
    status: version?.status ?? estimate.status,
    customerFirstName: estimate.customer.firstName,
    vehicle: [estimate.vehicle.year, estimate.vehicle.make, estimate.vehicle.model]
      .filter(Boolean)
      .join(" "),
    total: version?.total ?? 0,
    currency: version?.currency ?? "USD",
    sentAt: version?.sentAt ?? null,
    approvalPath: linkLive ? `/approve/${version!.approvalToken}` : null,
  });
};

async function loadCheckout(externalId: string) {
  if (!/^[\w-]{16,100}$/.test(externalId)) throw ApiError.notFound("This payment link is not valid.");
  const attempt = await db.paymentAttempt.findFirst({
    where: { externalId, method: { in: ["QR_CODE", "CARD_ONLINE"] } },
    include: {
      invoice: { select: { number: true, total: true, amountPaid: true, amountCredited: true } },
      organization: { select: { name: true } },
    },
  });
  if (!attempt) throw ApiError.notFound("This payment link is not valid.");
  return attempt;
}

function checkoutView(attempt: Awaited<ReturnType<typeof loadCheckout>>) {
  return {
    shopName: attempt.organization.name,
    invoiceNumber: attempt.invoice.number,
    amount: attempt.amount,
    currency: attempt.currency,
    status: attempt.status,
    canPay: env.demoPayments && attempt.provider === "mock" && attempt.status === "PENDING",
  };
}

export const getCheckout = async (req: Request, res: Response) => {
  res.json(checkoutView(await loadCheckout(req.params.externalId)));
};

export const payCheckout = async (req: Request, res: Response) => {
  const { outcome } = z
    .object({ outcome: z.enum(["approve", "decline"]).default("approve") })
    .parse(req.body ?? {});
  const attempt = await loadCheckout(req.params.externalId);
  if (!checkoutView(attempt).canPay) {
    throw ApiError.conflict(
      attempt.status === "SUCCEEDED"
        ? "This payment is already complete. Thank you!"
        : "This payment link is no longer active. Ask the shop for a new one.",
    );
  }

  const { mockProvider } = await import("../../providers/mock.js");
  if (outcome === "approve") mockProvider.settle(attempt.externalId!);
  else mockProvider.fail(attempt.externalId!);

  await resolveAttempt({ attemptId: attempt.id, organizationId: attempt.organizationId });
  res.json(checkoutView(await loadCheckout(req.params.externalId)));
};
