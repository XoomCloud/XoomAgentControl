import type { Db } from "@xoom/db";
import type { AuditAction } from "@xoom/shared-types";

export interface AuditContext {
  actorUserId?: string | null;
  ipAddress?: string | null;
}

/**
 * Records an audit log entry. Every mutating admin action must call this.
 * Failures here are logged but never block the underlying operation.
 */
export async function recordAudit(
  db: Db,
  ctx: AuditContext,
  action: AuditAction | string,
  opts: {
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorUserId: ctx.actorUserId ?? null,
        action,
        targetType: opts.targetType ?? null,
        targetId: opts.targetId ?? null,
        ipAddress: ctx.ipAddress ?? null,
        metadataJson: (opts.metadata ?? {}) as object,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("audit log write failed", { action, err });
  }
}

/** Records a tenant-scoped event (shown on the tenant detail page + logs). */
export async function recordTenantEvent(
  db: Db,
  tenantId: string,
  eventType: string,
  message: string,
  opts: { severity?: "debug" | "info" | "warning" | "error" | "critical"; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    await db.tenantEvent.create({
      data: {
        tenantId,
        eventType,
        severity: opts.severity ?? "info",
        message,
        metadataJson: (opts.metadata ?? {}) as object,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("tenant event write failed", { tenantId, eventType, err });
  }
}
