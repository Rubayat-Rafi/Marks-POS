import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { env } from "../env.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../http/errors.js";

export type AuthContext = {
  userId: string;
  email: string;
  name: string;
  organizationId: string;
  /** null means every location in the organization. */
  locationId: string | null;
  role: Role;
  membershipId: string;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export type TokenPayload = {
  sub: string;
  membershipId: string;
  iat?: number;
};

export const SESSION_COOKIE = "autoshop_session";

/**
 * Header the web client sends on every request. A cross-site form cannot set
 * a custom header, and a cross-site fetch that tries to is stopped by the CORS
 * preflight, so requiring it on cookie-authenticated writes blocks CSRF.
 */
export const CSRF_HEADER = "x-requested-with";

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
    algorithm: "HS256",
  } as jwt.SignOptions);
}

/** Session lifetime in ms, matching the token's own expiry. */
function sessionMaxAgeMs(): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(env.jwtExpiresIn.trim());
  if (!match) return 12 * 3_600_000;
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] ?? "s"]!;
  return Number(match[1]) * unit;
}

/**
 * The session lives in an httpOnly cookie, so script running in the page
 * (an injected ad, a compromised dependency) cannot read or exfiltrate it.
 */
export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/api",
    maxAge: sessionMaxAgeMs(),
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/api",
  });
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** The raw session token, from the cookie or (for non-browser clients) a bearer header. */
function sessionToken(req: Request): { token: string; viaCookie: boolean } | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return { token: header.slice(7), viaCookie: false };
  const cookie = readCookie(req, SESSION_COOKIE);
  return cookie ? { token: cookie, viaCookie: true } : null;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Resolve the signed-in membership, or null when there is no valid session. */
export async function loadSession(req: Request): Promise<AuthContext | null> {
  const found = sessionToken(req);
  if (!found) return null;

  if (found.viaCookie && !SAFE_METHODS.has(req.method) && !req.headers[CSRF_HEADER]) {
    throw ApiError.forbidden("This request is missing its security header. Reload the page.");
  }

  let payload: TokenPayload;
  try {
    payload = jwt.verify(found.token, env.jwtSecret, { algorithms: ["HS256"] }) as TokenPayload;
  } catch {
    throw ApiError.unauthorized("Your session has expired. Sign in again.");
  }

  const membership = await prisma.membership.findUnique({
    where: { id: payload.membershipId },
    include: { user: true, organization: true },
  });

  if (
    !membership ||
    !membership.isActive ||
    membership.userId !== payload.sub ||
    !membership.user.isActive
  ) {
    // Access is revoked the moment the membership or user is deactivated.
    throw ApiError.unauthorized("Your access has been removed.");
  }

  // A password change signs out every session issued before it.
  const changedAt = membership.user.passwordChangedAt?.getTime();
  if (changedAt && (payload.iat ?? 0) * 1000 < changedAt - 1000) {
    throw ApiError.unauthorized("Your password was changed. Sign in again.");
  }

  return {
    userId: membership.userId,
    email: membership.user.email,
    name: `${membership.user.firstName} ${membership.user.lastName}`,
    organizationId: membership.organizationId,
    locationId: membership.locationId,
    role: membership.role,
    membershipId: membership.id,
  };
}

/**
 * The authenticated session decides the tenant. A shop id in the request body
 * or query string is never trusted (build guide / 06).
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const session = await loadSession(req);
    if (!session) throw ApiError.unauthorized();
    req.auth = session;
    next();
  } catch (err) {
    next(err);
  }
}

export function auth(req: Request): AuthContext {
  if (!req.auth) throw ApiError.unauthorized();
  return req.auth;
}

/**
 * Tenant filter for every query. Callers spread this into `where`, which makes
 * a missing tenant check visible in review.
 */
export function tenantScope(req: Request) {
  return { organizationId: auth(req).organizationId };
}

/**
 * Resolve the location for a write. A membership pinned to one location cannot
 * write to another, whatever the body says.
 */
export async function resolveLocationId(
  req: Request,
  requested?: string | null,
): Promise<string> {
  const ctx = auth(req);
  if (ctx.locationId) {
    if (requested && requested !== ctx.locationId) {
      throw ApiError.forbidden("You do not have access to that location.");
    }
    return ctx.locationId;
  }
  if (requested) {
    const location = await prisma.location.findFirst({
      where: { id: requested, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!location) throw ApiError.forbidden("You do not have access to that location.");
    return location.id;
  }
  const fallback = await prisma.location.findFirst({
    where: { organizationId: ctx.organizationId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!fallback) throw ApiError.unprocessable("This shop has no active location yet.");
  return fallback.id;
}
