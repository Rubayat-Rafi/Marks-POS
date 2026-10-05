import type { Request } from "express";
import type { Tx } from "./prisma.js";

export type AuditInput = {
  organizationId: string;
  actorId?: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  reason?: string | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
};

/**
 * Audit rows record actor, time, tenant, action, resource, reason and a
 * correlation id. Card details are never written here (build guide / 12).
 */
export async function recordAudit(tx: Tx, input: AuditInput) {
  return tx.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorId: input.actorId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      reason: input.reason ?? null,
      correlationId: input.correlationId ?? null,
      metadata: (input.metadata ?? {}) as object,
      ip: input.ip ?? null,
    },
  });
}

export function auditContext(req: Request) {
  return {
    actorId: req.auth?.userId ?? null,
    correlationId: (req.res?.locals.requestId as string | undefined) ?? null,
    ip: req.ip ?? null,
  };
}
