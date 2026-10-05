import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../../db.js";
import { ApiError } from "../../middlewares/error.middleware.js";
import {
  auth,
  clearSessionCookie,
  loadSession,
  setSessionCookie,
  signToken,
} from "../../middlewares/auth.middleware.js";
import { permissionsForRole } from "../../middlewares/rbac.middleware.js";
import { recordAudit } from "../../lib/audit.js";
import { RateLimiter } from "../../middlewares/rateLimit.middleware.js";

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
  membershipId: z.string().uuid().optional(),
});

const failedByAccount = new RateLimiter(8, 15 * 60_000);
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password-placeholder", 10);

type MembershipWithRelations = {
  id: string;
  role: import("@prisma/client").Role;
  organizationId: string;
  locationId: string | null;
  organization: { id: string; name: string; currency: string; timezone: string; paymentProvider: string };
  location: { id: string; name: string } | null;
};

export function sessionPayload(
  user: { id: string; email: string; firstName: string; lastName: string },
  membership: MembershipWithRelations,
) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: membership.role,
    membershipId: membership.id,
    organization: {
      id: membership.organization.id,
      name: membership.organization.name,
      currency: membership.organization.currency,
      timezone: membership.organization.timezone,
      paymentProvider: membership.organization.paymentProvider,
    },
    location: membership.location
      ? { id: membership.location.id, name: membership.location.name }
      : null,
    permissions: permissionsForRole(membership.role),
  };
}

export async function login(req: Request, res: Response) {
  const body = loginSchema.parse(req.body);
  const email = body.email.toLowerCase();

  const user = await db.user.findUnique({
    where: { email },
    include: {
      memberships: {
        where: { isActive: true },
        include: { organization: true, location: true },
      },
    },
  });

  const invalid = ApiError.unauthorized("That email and password do not match.");
  const passwordOk = await bcrypt.compare(body.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.isActive || !passwordOk) {
    if (failedByAccount.hit(email) > 0) {
      throw new ApiError(
        429,
        "rate_limited",
        "Too many wrong passwords for this account. Wait 15 minutes and try again.",
      );
    }
    throw invalid;
  }
  failedByAccount.reset(email);
  if (user.memberships.length === 0) {
    throw ApiError.forbidden("Your account is not attached to a shop yet.");
  }

  if (user.memberships.length > 1 && !body.membershipId) {
    res.json({
      needsShopChoice: true,
      memberships: user.memberships.map((m) => ({
        id: m.id,
        organizationName: m.organization.name,
        locationName: m.location?.name ?? "All locations",
        role: m.role,
      })),
    });
    return;
  }

  const membership = body.membershipId
    ? user.memberships.find((m) => m.id === body.membershipId)
    : user.memberships[0];
  if (!membership) throw invalid;

  await db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await recordAudit(db, {
    organizationId: membership.organizationId,
    actorId: user.id,
    action: "auth.login",
    resourceType: "user",
    resourceId: user.id,
    ip: req.ip,
  });

  setSessionCookie(res, signToken({ sub: user.id, membershipId: membership.id }));
  res.json({ user: sessionPayload(user, membership) });
}

export function logout(_req: Request, res: Response) {
  clearSessionCookie(res);
  res.json({ ok: true });
}

export async function getSession(req: Request, res: Response) {
  let session = null;
  try {
    session = await loadSession(req);
  } catch {
    clearSessionCookie(res);
  }
  if (!session) {
    res.json({ user: null });
    return;
  }
  const membership = await db.membership.findUnique({
    where: { id: session.membershipId },
    include: { user: true, organization: true, location: true },
  });
  res.json({ user: membership ? sessionPayload(membership.user, membership) : null });
}

export async function getMe(req: Request, res: Response) {
  const ctx = auth(req);
  const membership = await db.membership.findUnique({
    where: { id: ctx.membershipId },
    include: { user: true, organization: true, location: true },
  });
  if (!membership) throw ApiError.unauthorized();

  res.json({ user: sessionPayload(membership.user, membership) });
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(10, "Use at least 10 characters.").max(200),
});

export async function changePassword(req: Request, res: Response) {
  const ctx = auth(req);
  const body = changePasswordSchema.parse(req.body);

  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
    throw ApiError.unauthorized("Your current password is not correct.");
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(body.newPassword, 12),
      passwordChangedAt: new Date(),
    },
  });
  setSessionCookie(res, signToken({ sub: user.id, membershipId: ctx.membershipId }));
  await recordAudit(db, {
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    action: "auth.password_changed",
    resourceType: "user",
    resourceId: user.id,
    ip: req.ip,
  });

  res.json({ ok: true });
}
