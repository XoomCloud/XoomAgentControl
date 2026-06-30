import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { AgentActionRequest, AUDIT_ACTIONS } from "@xoom/shared-types";
import { recordAudit, recordTenantEvent } from "../../lib/audit.js";
import { jsonSafe } from "../../lib/serialize.js";

const IdParam = z.object({ id: z.string() });
const AgentQuery = z.object({
  tenant_id: z.string().optional(),
  status: z.enum(["online", "degraded", "offline", "paused", "error"]).optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const ACTION_TO_COMMAND: Record<string, string | null> = {
  restart: "restart_tenant",
  pause: "stop_tenant",
  resume: "start_tenant",
  clone: null,
  export: null,
};

/** Deployed-agent registry + lifecycle actions. Registered at /api/agents. */
export async function agentRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/", { preHandler: app.requireUser(), schema: { querystring: AgentQuery, tags: ["agents"] } }, async (req) => {
    const { tenant_id, status, q, limit } = req.query;
    const where: Record<string, unknown> = {};
    if (tenant_id) where.tenantId = tenant_id;
    if (status) where.status = status;
    if (q) where.name = { contains: q, mode: "insensitive" };
    const agents = await app.db.agent.findMany({
      where,
      include: { tenant: { select: { slug: true, name: true } } },
      orderBy: { lastSeenAt: "desc" },
      take: limit,
    });
    return { agents: jsonSafe(agents) };
  });

  app.get("/:id", { preHandler: app.requireUser(), schema: { params: IdParam, tags: ["agents"] } }, async (req, reply) => {
    const agent = await app.db.agent.findUnique({
      where: { id: req.params.id },
      include: { tenant: { select: { id: true, slug: true, name: true, assignedHostId: true } } },
    });
    if (!agent) return reply.code(404).send({ error: "not_found" });
    return { agent: jsonSafe(agent) };
  });

  // Lifecycle actions map to host commands against the agent's tenant MicroVM.
  app.post("/:id/actions", { preHandler: app.requireUser({ write: true }), schema: { params: IdParam, body: AgentActionRequest, tags: ["agents"] } }, async (req, reply) => {
    const agent = await app.db.agent.findUnique({ where: { id: req.params.id }, include: { tenant: true } });
    if (!agent) return reply.code(404).send({ error: "not_found" });
    const commandType = ACTION_TO_COMMAND[req.body.action];

    let commandId: string | null = null;
    if (commandType && agent.tenant.assignedHostId) {
      const cmd = await app.db.hostCommand.create({
        data: {
          hostId: agent.tenant.assignedHostId,
          tenantId: agent.tenantId,
          commandType: commandType as never,
          status: "queued",
          payloadJson: { tenant_slug: agent.tenant.slug, agent_external_id: agent.externalId, agent_action: req.body.action },
        },
      });
      commandId = cmd.id;
    }
    if (req.body.action === "pause") await app.db.agent.update({ where: { id: agent.id }, data: { status: "paused" } });
    if (req.body.action === "resume") await app.db.agent.update({ where: { id: agent.id }, data: { status: "online" } });

    await recordTenantEvent(app.db, agent.tenantId, `agent.${req.body.action}`, `Agent ${agent.name}: ${req.body.action}`, { metadata: { agentId: agent.id, commandId } });
    await recordAudit(app.db, { actorUserId: req.user!.id, ipAddress: req.ip }, AUDIT_ACTIONS.TENANT_ACTION, {
      targetType: "agent",
      targetId: agent.id,
      metadata: { action: req.body.action, commandId },
    });
    return { ok: true, commandId };
  });
}
