import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { CreateCommandRequest, CommandStatus, AUDIT_ACTIONS } from "@xoom/shared-types";
import { recordAudit } from "../../lib/audit.js";
import { jsonSafe } from "../../lib/serialize.js";

const IdParam = z.object({ id: z.string() });
const CommandQuery = z.object({
  status: CommandStatus.optional(),
  host_id: z.string().optional(),
  tenant_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Deployments view: command queue across all hosts. Surfaces pending + failed
 * commands and supports retry.
 */
export async function commandRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/", { preHandler: app.requireUser(), schema: { querystring: CommandQuery, tags: ["commands"] } }, async (req) => {
    const { status, host_id, tenant_id, limit } = req.query;
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (host_id) where.hostId = host_id;
    if (tenant_id) where.tenantId = tenant_id;
    const commands = await app.db.hostCommand.findMany({
      where,
      include: {
        host: { select: { id: true, name: true } },
        tenant: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return { commands: jsonSafe(commands) };
  });

  app.get("/:id", { preHandler: app.requireUser(), schema: { params: IdParam, tags: ["commands"] } }, async (req, reply) => {
    const command = await app.db.hostCommand.findUnique({
      where: { id: req.params.id },
      include: { host: true, tenant: true },
    });
    if (!command) return reply.code(404).send({ error: "not_found" });
    return { command: jsonSafe(command) };
  });

  // Manually enqueue a command (e.g. collect_logs, ad-hoc ops).
  app.post("/", { preHandler: app.requireUser({ write: true }), schema: { body: CreateCommandRequest, tags: ["commands"] } }, async (req, reply) => {
    const { host_id, tenant_id, command_type, payload } = req.body;
    const command = await app.db.hostCommand.create({
      data: {
        hostId: host_id,
        tenantId: tenant_id ?? null,
        commandType: command_type,
        status: "queued",
        payloadJson: (payload ?? {}) as object,
      },
    });
    await recordAudit(app.db, { actorUserId: req.user!.id, ipAddress: req.ip }, AUDIT_ACTIONS.COMMAND_CREATED, {
      targetType: "command",
      targetId: command.id,
      metadata: { command_type, host_id, tenant_id },
    });
    return reply.code(201).send({ command: jsonSafe(command) });
  });

  // Retry a failed command (re-queues a fresh copy).
  app.post("/:id/retry", { preHandler: app.requireUser({ write: true }), schema: { params: IdParam, tags: ["commands"] } }, async (req, reply) => {
    const original = await app.db.hostCommand.findUnique({ where: { id: req.params.id } });
    if (!original) return reply.code(404).send({ error: "not_found" });
    const retry = await app.db.hostCommand.create({
      data: {
        hostId: original.hostId,
        tenantId: original.tenantId,
        commandType: original.commandType,
        status: "queued",
        payloadJson: (original.payloadJson ?? {}) as object,
      },
    });
    await recordAudit(app.db, { actorUserId: req.user!.id, ipAddress: req.ip }, AUDIT_ACTIONS.COMMAND_RETRIED, {
      targetType: "command",
      targetId: retry.id,
      metadata: { retried_from: original.id },
    });
    return reply.code(201).send({ command: jsonSafe(retry) });
  });
}
