import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ApproveHostRequest, HostMaintenanceRequest, AUDIT_ACTIONS } from "@xoom/shared-types";
import { canPerformDestructive } from "@xoom/auth";
import { recordAudit } from "../../lib/audit.js";
import { jsonSafe } from "../../lib/serialize.js";

const IdParam = z.object({ id: z.string() });

export async function hostAdminRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // List hosts with derived online/offline (stale heartbeat) status.
  app.get("/", { preHandler: app.requireUser(), schema: { tags: ["hosts"] } }, async () => {
    const hosts = await app.db.host.findMany({
      include: { _count: { select: { tenants: true } } },
      orderBy: { createdAt: "desc" },
    });
    const threshold = app.config.OFFLINE_THRESHOLD_SECONDS * 1000;
    const now = Date.now();
    const enriched = hosts.map((h) => ({
      ...h,
      derived_status:
        h.status === "maintenance" || h.status === "draining"
          ? h.status
          : h.lastSeenAt && now - h.lastSeenAt.getTime() < threshold
            ? "online"
            : "offline",
    }));
    return { hosts: jsonSafe(enriched) };
  });

  // Host detail: capacity, running microvms, recent heartbeats + commands.
  app.get("/:id", { preHandler: app.requireUser(), schema: { params: IdParam, tags: ["hosts"] } }, async (req, reply) => {
    const host = await app.db.host.findUnique({
      where: { id: req.params.id },
      include: {
        tenants: { select: { id: true, name: true, slug: true, status: true } },
        heartbeats: { orderBy: { createdAt: "desc" }, take: 30 },
        commands: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    if (!host) return reply.code(404).send({ error: "not_found" });
    return { host: jsonSafe(host) };
  });

  // Host logs (forwarded events tagged to this host's tenants + heartbeat stream)
  app.get("/:id/logs", { preHandler: app.requireUser(), schema: { params: IdParam, tags: ["hosts"] } }, async (req) => {
    const heartbeats = await app.db.hostHeartbeat.findMany({
      where: { hostId: req.params.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return { heartbeats: jsonSafe(heartbeats) };
  });

  // Approve a host (issues long-lived credential trust). RBAC: msp_admin+
  app.post("/:id/approve", { preHandler: app.requireUser({ write: true }), schema: { params: IdParam, body: ApproveHostRequest, tags: ["hosts"] } }, async (req, reply) => {
    if (!canPerformDestructive(req.user!.role)) return reply.code(403).send({ error: "forbidden" });
    const host = await app.db.host.update({ where: { id: req.params.id }, data: { approved: req.body.approved } });
    await recordAudit(app.db, { actorUserId: req.user!.id, ipAddress: req.ip }, AUDIT_ACTIONS.HOST_APPROVED, {
      targetType: "host",
      targetId: host.id,
      metadata: { approved: req.body.approved },
    });
    return { ok: true, approved: host.approved };
  });

  // Maintenance / draining toggle
  app.post("/:id/maintenance", { preHandler: app.requireUser({ write: true }), schema: { params: IdParam, body: HostMaintenanceRequest, tags: ["hosts"] } }, async (req) => {
    const host = await app.db.host.update({ where: { id: req.params.id }, data: { status: req.body.status } });
    await recordAudit(app.db, { actorUserId: req.user!.id, ipAddress: req.ip }, AUDIT_ACTIONS.HOST_MAINTENANCE, {
      targetType: "host",
      targetId: host.id,
      metadata: { status: req.body.status },
    });
    return { ok: true, status: host.status };
  });
}
