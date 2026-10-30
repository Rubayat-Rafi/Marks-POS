import type { NextFunction, Request, Response } from "express";
import type { Role } from "@prisma/client";
import { ApiError } from "./error.middleware.js";
import { auth } from "./auth.middleware.js";

export const PERMISSIONS = {
  "timeclock.use": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "TECHNICIAN", "BOOKKEEPER"],
  "customers.read": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "BOOKKEEPER", "TECHNICIAN"],
  "customers.write": ["OWNER", "MANAGER", "SERVICE_ADVISOR"],
  "customers.export": ["OWNER", "MANAGER", "BOOKKEEPER"],
  "vehicles.read": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "TECHNICIAN", "BOOKKEEPER"],
  "vehicles.write": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "TECHNICIAN"],
  "appointments.read": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "TECHNICIAN"],
  "appointments.write": ["OWNER", "MANAGER", "SERVICE_ADVISOR"],
  "jobs.read": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "TECHNICIAN", "BOOKKEEPER"],
  "jobs.write": ["OWNER", "MANAGER", "SERVICE_ADVISOR"],
  "jobs.technician": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "TECHNICIAN"],
  "inspections.write": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "TECHNICIAN"],
  "estimates.read": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "TECHNICIAN"],
  "estimates.write": ["OWNER", "MANAGER", "SERVICE_ADVISOR"],
  "invoices.read": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "BOOKKEEPER"],
  "invoices.write": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "BOOKKEEPER"],
  "payments.collect": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "BOOKKEEPER"],
  "payments.refund": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "BOOKKEEPER"],
  "payments.refund.large": ["OWNER", "MANAGER"],
  "credits.issue": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "BOOKKEEPER"],
  "expenses.write": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "BOOKKEEPER"],
  "finance.read": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "BOOKKEEPER"],
  "finance.reconcile": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "BOOKKEEPER"],
  "reports.costs": ["OWNER", "MANAGER", "BOOKKEEPER"],
  "reports.sales": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "BOOKKEEPER"],
  "settings.read": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "BOOKKEEPER"],
  "settings.write": ["OWNER", "MANAGER"],
  "staff.manage": ["OWNER", "MANAGER"],
  "providers.manage": ["OWNER", "MANAGER"],
  "audit.read": ["OWNER", "MANAGER"],
  "payroll.read": ["OWNER", "MANAGER", "BOOKKEEPER"],
  "payroll.write": ["OWNER", "MANAGER", "BOOKKEEPER"],
  "parts_catalog.write": ["OWNER", "MANAGER", "SERVICE_ADVISOR"],
  "inventory.read": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "TECHNICIAN", "BOOKKEEPER"],
  "inventory.receive": ["OWNER", "MANAGER", "SERVICE_ADVISOR"],
  "inventory.manage": ["OWNER", "MANAGER", "SERVICE_ADVISOR"],
  "sales.quick": ["OWNER", "MANAGER", "SERVICE_ADVISOR"],
  "bookings.read": ["OWNER", "MANAGER", "SERVICE_ADVISOR"],
  "bookings.write": ["OWNER", "MANAGER", "SERVICE_ADVISOR"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;
export const MANAGER_REFUND_LIMIT_CENTS = 50_000;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const ctx = auth(req);
      if (!can(ctx.role, permission)) {
        throw ApiError.forbidden(
          `Your role (${ctx.role.toLowerCase().replace("_", " ")}) cannot ${permission.replace(".", " ")}.`,
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function assertPermission(role: Role, permission: Permission) {
  if (!can(role, permission)) {
    throw ApiError.forbidden(`Your role cannot ${permission.replace(".", " ")}.`);
  }
}

export function permissionsForRole(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
}
