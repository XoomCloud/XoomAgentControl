import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { CreateSecretRequest, AUDIT_ACTIONS } from "@xoom/shared-types";
import { recordAudit } from "../../lib/audit.js";
import { jsonSafe } from "../../lib/serialize.js";

const EventQuery = z.object({
  tenant_id: z.string().optional(),
  severity: z.enum(["debug", "info", "warning", "error", "critical"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
const AuditQuery = z.object({
  actor_user_id: z.string().optional(),
  target_type: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
const UsageQuery = z.object({ tenant_id: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) });
const SecretIdParam = z.object({ id: z.string() });

/**
 * Logs & Metrics + Audit + Secrets. Registered under /api so paths are
 * /api/events, /api/audit-logs, /api/usage, /api/secrets.
 */
export async function logsRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Tenant + agent runtime events
  app.get("/events", { preHandler: app.requireUser(), schema: { querystring: EventQuery, tags: ["logs"] } }, async (req) => {
    const { tenant_id, severity, limit } = req.query;
    const where: Record<string, unknown> = {};
    if (tenant_id) where.tenantId = tenant_id;
    if (severity) where.severity = severity;
    const events = await app.db.tenantEvent.findMany({
      where,
      include: { tenant: { select: { slug: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return { events: jsonSafe(events) };
  });

  // Audit trail
  app.get("/audit-logs", { preHandler: app.requireUser(), schema: { querystring: AuditQuery, tags: ["logs"] } }, async (req) => {
    const { actor_user_id, target_type, limit } = req.query;
    const where: Record<string, unknown> = {};
    if (actor_user_id) where.actorUserId = actor_user_id;
    if (target_type) where.targetType = target_type;
    const logs = await app.db.auditLog.findMany({
      where,
      include: { actor: { select: { email: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return { audit_logs: jsonSafe(logs) };
  });

  // Token usage / spend metrics
  app.get("/usage", { preHandler: app.requireUser(), schema: { querystring: UsageQuery, tags: ["logs"] } }, async (req) => {
    const { tenant_id, limit } = req.query;
    const where: Record<string, unknown> = {};
    if (tenant_id) where.tenantId = tenant_id;
    const metrics = await app.db.usageMetric.findMany({ where, orderBy: { windowStart: "desc" }, take: limit });
    return { usage: jsonSafe(metrics) };
  });

  // --- Secrets references (never returns plaintext) ---
  app.get("/secrets", { preHandler: app.requireUser(), schema: { querystring: z.object({ tenant_id: z.string().optional() }), tags: ["secrets"] } }, async (req) => {
    const where: Record<string, unknown> = {};
    if (req.query.tenant_id) where.tenantId = req.query.tenant_id;
    const secrets = await app.db.secretReference.findMany({
      where,
      select: { id: true, tenantId: true, name: true, provider: true, externalSecretRef: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: "desc" },
    });
    return { secrets: jsonSafe(secrets) };
  });

  app.post("/secrets", { preHandler: app.requireUser({ write: true }), schema: { body: CreateSecretRequest, tags: ["secrets"] } }, async (req, reply) => {
    const b = req.body;
    const externalRef = b.external_secret_ref ?? `tenant/${b.tenant_id ?? "platform"}/${b.name}`;
    let encryptedValue: string | undefined;
    if (b.provider === "local") {
      if (!b.value) return reply.code(400).send({ error: "validation_error", message: "value required for local provider" });
      const stored = await app.secrets.store({ ref: externalRef, value: b.value });
      encryptedValue = stored.ciphertext;
    }
    // Compound-unique upsert is awkward with a nullable tenantId + FK, so we
    // look up the existing reference explicitly and update or create.
    const existing = await app.db.secretReference.findFirst({
      where: { tenantId: b.tenant_id ?? null, name: b.name },
    });
    const secret = existing
      ? await app.db.secretReference.update({
          where: { id: existing.id },
          data: { provider: b.provider, externalSecretRef: externalRef, encryptedValue },
        })
      : await app.db.secretReference.create({
          data: { tenantId: b.tenant_id ?? null, name: b.name, provider: b.provider, externalSecretRef: externalRef, encryptedValue },
        });
    await recordAudit(app.db, { actorUserId: req.user!.id, ipAddress: req.ip }, AUDIT_ACTIONS.SECRET_CHANGED, {
      targetType: "secret",
      targetId: secret.id,
      metadata: { name: b.name, provider: b.provider, tenant_id: b.tenant_id },
    });
    return reply.code(201).send({ secret: { id: secret.id, name: secret.name, provider: secret.provider, externalSecretRef: secret.externalSecretRef } });
  });

  app.delete("/secrets/:id", { preHandler: app.requireUser({ write: true }), schema: { params: SecretIdParam, tags: ["secrets"] } }, async (req) => {
    await app.db.secretReference.delete({ where: { id: req.params.id } });
    await recordAudit(app.db, { actorUserId: req.user!.id, ipAddress: req.ip }, AUDIT_ACTIONS.SECRET_CHANGED, {
      targetType: "secret",
      targetId: req.params.id,
      metadata: { deleted: true },
    });
    return { ok: true };
  });
}
