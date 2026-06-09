import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  CreateTenantRequest,
  UpdateTenantRequest,
  TenantActionRequest,
  ListQuery,
  AUDIT_ACTIONS,
} from "@xoom/shared-types";
import { canPerformDestructive } from "@xoom/auth";
import { recordAudit } from "../../lib/audit.js";
import { jsonSafe } from "../../lib/serialize.js";
import { TenantService } from "./service.js";

const IdParam = z.object({ id: z.string() });

export async function tenantRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const service = () =>
    new TenantService({ db: app.db, config: app.config, llm: app.llm, memory: app.memory, secrets: app.secrets });

  // List tenants
  app.get("/", { preHandler: app.requireUser(), schema: { querystring: ListQuery, tags: ["tenants"] } }, async (req) => {
    const { status, q, limit, offset } = req.query;
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }];
    const [tenants, total] = await Promise.all([
      app.db.tenant.findMany({
        where,
        include: { assignedHost: { select: { id: true, name: true, status: true } }, resourceLimits: true },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      app.db.tenant.count({ where }),
    ]);
    return { tenants: jsonSafe(tenants), total, limit, offset };
  });

  // Tenant detail (status, host, runtime, limits, configs, recent events)
  app.get("/:id", { preHandler: app.requireUser(), schema: { params: IdParam, tags: ["tenants"] } }, async (req, reply) => {
    const tenant = await app.db.tenant.findUnique({
      where: { id: req.params.id },
      include: {
        assignedHost: true,
        resourceLimits: true,
        runtimeConfig: true,
        mcpAccess: { include: { mcpServer: true } },
        secrets: { select: { id: true, name: true, provider: true, externalSecretRef: true, createdAt: true } },
        events: { orderBy: { createdAt: "desc" }, take: 25 },
        commands: { orderBy: { createdAt: "desc" }, take: 10 },
        backups: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });
    if (!tenant) return reply.code(404).send({ error: "not_found" });
    return { tenant: jsonSafe(tenant) };
  });

  // Create tenant (full provisioning flow)
  app.post("/", { preHandler: app.requireUser({ write: true }), schema: { body: CreateTenantRequest, tags: ["tenants"] } }, async (req, reply) => {
    const result = await service().createTenant(req.body);
    await recordAudit(app.db, { actorUserId: req.user!.id, ipAddress: req.ip }, AUDIT_ACTIONS.TENANT_CREATED, {
      targetType: "tenant",
      targetId: result.tenantId,
      metadata: { slug: req.body.slug, status: result.status },
    });
    return reply.code(201).send(result);
  });

  // Edit tenant metadata / limits
  app.patch("/:id", { preHandler: app.requireUser({ write: true }), schema: { params: IdParam, body: UpdateTenantRequest, tags: ["tenants"] } }, async (req, reply) => {
    const body = req.body;
    const tenant = await app.db.tenant.findUnique({ where: { id: req.params.id } });
    if (!tenant) return reply.code(404).send({ error: "not_found" });

    await app.db.tenant.update({
      where: { id: req.params.id },
      data: {
        name: body.name ?? undefined,
        domain: body.domain ?? undefined,
        runtimeVersion: body.runtime_version ?? undefined,
      },
    });
    if (body.resource_limits) {
      const rl = body.resource_limits;
      await app.db.tenantResourceLimit.update({
        where: { tenantId: req.params.id },
        data: {
          vcpu: rl.vcpu,
          ramMb: rl.ram_mb,
          diskGb: rl.disk_gb,
          maxAgents: rl.max_agents,
          maxMonthlySpend: rl.max_monthly_spend,
          maxTokensPerDay: rl.max_tokens_per_day !== undefined ? BigInt(rl.max_tokens_per_day) : undefined,
          maxMcpTools: rl.max_mcp_tools,
        },
      });
    }
    await recordAudit(app.db, { actorUserId: req.user!.id, ipAddress: req.ip }, AUDIT_ACTIONS.TENANT_UPDATED, {
      targetType: "tenant",
      targetId: req.params.id,
    });
    return { ok: true };
  });

  // Lifecycle actions: start/stop/restart/backup/update_runtime/suspend/delete
  app.post("/:id/actions", { preHandler: app.requireUser({ write: true }), schema: { params: IdParam, body: TenantActionRequest, tags: ["tenants"] } }, async (req, reply) => {
    const { action, runtime_version } = req.body;
    if ((action === "delete" || action === "suspend") && !canPerformDestructive(req.user!.role)) {
      return reply.code(403).send({ error: "forbidden", message: "Insufficient role for destructive action" });
    }
    const result = await service().runAction(req.params.id, action, runtime_version);
    const auditAction =
      action === "delete"
        ? AUDIT_ACTIONS.TENANT_DELETED
        : action === "suspend"
          ? AUDIT_ACTIONS.TENANT_SUSPENDED
          : AUDIT_ACTIONS.TENANT_ACTION;
    await recordAudit(app.db, { actorUserId: req.user!.id, ipAddress: req.ip }, auditAction, {
      targetType: "tenant",
      targetId: req.params.id,
      metadata: { action, commandId: result.commandId },
    });
    return result;
  });

  // Tenant health summary
  app.get("/:id/health", { preHandler: app.requireUser(), schema: { params: IdParam, tags: ["tenants"] } }, async (req, reply) => {
    const tenant = await app.db.tenant.findUnique({
      where: { id: req.params.id },
      include: { assignedHost: { select: { status: true, lastSeenAt: true } } },
    });
    if (!tenant) return reply.code(404).send({ error: "not_found" });
    const lastError = await app.db.tenantEvent.findFirst({
      where: { tenantId: tenant.id, severity: { in: ["error", "critical"] } },
      orderBy: { createdAt: "desc" },
    });
    return {
      tenant_id: tenant.id,
      status: tenant.status,
      runtime: { type: tenant.runtimeType, version: tenant.runtimeVersion },
      host_status: tenant.assignedHost?.status ?? null,
      host_last_seen: tenant.assignedHost?.lastSeenAt ?? null,
      last_error: lastError ? { message: lastError.message, at: lastError.createdAt } : null,
    };
  });

  // Tenant runtime callback (SwarmClaw -> control plane webhook)
  app.post("/:id/callback", { schema: { params: IdParam, body: z.record(z.unknown()), tags: ["tenants"] } }, async (req, reply) => {
    const tenant = await app.db.tenant.findUnique({ where: { id: req.params.id } });
    if (!tenant) return reply.code(404).send({ error: "not_found" });
    const body = req.body as { event_type?: string; message?: string; runtime_url?: string };
    await app.db.tenantEvent.create({
      data: {
        tenantId: tenant.id,
        eventType: body.event_type ?? "runtime.callback",
        severity: "info",
        message: body.message ?? "Runtime callback",
        metadataJson: body as object,
      },
    });
    if (body.runtime_url) {
      await app.db.tenant.update({ where: { id: tenant.id }, data: { domain: body.runtime_url } });
    }
    return { ok: true };
  });
}
