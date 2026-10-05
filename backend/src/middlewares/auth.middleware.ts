import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { env } from "../env.js";
import { db } from "../db.js";
import { ApiError } from "./error.middleware.js";

export type AuthContext = {
  userId: string;
  email: string;
  name: string;
  organizationId: string;
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
export const CSRF_HEADER = "x-requested-with";

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
    algorithm: "HS256",
  } as jwt.SignOptions);
}

function sessionMaxAgeMs(): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(env.jwtExpiresIn.trim());
  if (!match) return 12 * 3_600_000;
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] ?? "s"]!;
  return Number(match[1]) * unit;
}

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

function sessionToken(req: Request): { token: string; viaCookie: boolean } | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return { token: header.slice(7), viaCookie: false };
  const cookie = readCookie(req, SESSION_COOKIE);
  return cookie ? { token: cookie, viaCookie: true } : null;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

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

  const membership = await db.membership.findUnique({
    where: { id: payload.membershipId },
    include: { user: true, organization: true },
  });

  if (
    !membership ||
    !membership.isActive ||
    membership.userId !== payload.sub ||
    !membership.user.isActive
  ) {
    throw ApiError.unauthorized("Your access has been removed.");
  }

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

export function tenantScope(req: Request) {
  return { organizationId: auth(req).organizationId };
}

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
    const location = await db.location.findFirst({
      where: { id: requested, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!location) throw ApiError.forbidden("You do not have access to that location.");
    return location.id;
  }
  const fallback = await db.location.findFirst({
    where: { organizationId: ctx.organizationId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!fallback) throw ApiError.unprocessable("This shop has no active location yet.");
  return fallback.id;
}
