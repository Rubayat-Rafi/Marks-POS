import type { NextFunction, Request, Response } from "express";
import type { Role } from "@prisma/client";
import { ApiError } from "../http/errors.js";
import { auth } from "./auth.js";

/**
 * Permission catalogue from build guide / 03. Checks run on the server for
 * every read, write, report, export and file request. Hiding a button is a
 * usability choice, never the control.
 */
export const PERMISSIONS = {
  // Every active membership may punch their own shift clock; the endpoints
  // themselves only require being signed in. This entry exists so the web
  // nav can show the link to every role without hard-coding a role list.
  "timeclock.use": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "TECHNICIAN", "BOOKKEEPER"],

  // CRM and service operations
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

  // Money
  "invoices.read": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "BOOKKEEPER"],
  "invoices.write": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "BOOKKEEPER"],
  "payments.collect": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "BOOKKEEPER"],
  "payments.refund": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "BOOKKEEPER"],
  // A large refund needs an owner even where a manager may refund small ones.
  "payments.refund.large": ["OWNER", "MANAGER"],
  "credits.issue": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "BOOKKEEPER"],
  "expenses.write": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "BOOKKEEPER"],
  "finance.read": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "BOOKKEEPER"],
  "finance.reconcile": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "BOOKKEEPER"],
  // Cost and margin data is withheld from advisors and technicians.
  "reports.costs": ["OWNER", "MANAGER", "BOOKKEEPER"],
  "reports.sales": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "BOOKKEEPER"],

  // Administration
  "settings.read": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "BOOKKEEPER"],
  "settings.write": ["OWNER", "MANAGER"],
  "staff.manage": ["OWNER", "MANAGER"],
  "providers.manage": ["OWNER", "MANAGER"],
  "audit.read": ["OWNER", "MANAGER"],

  // Payroll. A worker's own hours and pay are reached through a "me" endpoint
  // that needs no permission beyond being signed in. Reading or setting
  // ANOTHER person's pay rate is kept narrower than "staff.manage" and even
  // narrower than job cost: a manager who can see shop margins does not
  // automatically see what a coworker is paid.
  "payroll.read": ["OWNER", "MANAGER", "BOOKKEEPER"],
  "payroll.write": ["OWNER", "MANAGER", "BOOKKEEPER"],

  // Parts reference data: fitment tagging and the vehicle make/model lookup.
  "parts_catalog.write": ["OWNER", "MANAGER", "SERVICE_ADVISOR"],

  // Serialised tire and muffler stock. Receiving stock happens at the counter,
  // so advisors may add serials; only owner and manager edit prices or write
  // stock off.
  "inventory.read": ["OWNER", "MANAGER", "SERVICE_ADVISOR", "TECHNICIAN", "BOOKKEEPER"],
  "inventory.receive": ["OWNER", "MANAGER", "SERVICE_ADVISOR"],
  "inventory.manage": ["OWNER", "MANAGER", "SERVICE_ADVISOR"],

  // The counter's quick sale: bill a walk-in job and print the receipt in one step.
  "sales.quick": ["OWNER", "MANAGER", "SERVICE_ADVISOR"],

  // Service requests from the public website.
  "bookings.read": ["OWNER", "MANAGER", "SERVICE_ADVISOR"],
  "bookings.write": ["OWNER", "MANAGER", "SERVICE_ADVISOR"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

/** Refund above this amount escalates to the owner-only permission. */
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

/** The permission map the web client uses to decide what to render. */
export function permissionsForRole(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
}
