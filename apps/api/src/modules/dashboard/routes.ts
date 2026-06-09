import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { jsonSafe } from "../../lib/serialize.js";

/** Overview dashboard aggregates (brief §1.1). */
export async function dashboardRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/summary", { preHandler: app.requireUser(), schema: { tags: ["dashboard"] } }, async () => {
    const offlineThreshold = new Date(Date.now() - app.config.OFFLINE_THRESHOLD_SECONDS * 1000);

    const [
      totalTenants,
      activeTenants,
      suspendedTenants,
      failedTenants,
      totalHosts,
      hosts,
      recentErrors,
      failedCommands,
      pendingCommands,
      usageAgg,
    ] = await Promise.all([
      app.db.tenant.count({ where: { status: { not: "deleted" } } }),
      app.db.tenant.count({ where: { status: "active" } }),
      app.db.tenant.count({ where: { status: "suspended" } }),
      app.db.tenant.count({ where: { status: "failed" } }),
      app.db.host.count(),
      app.db.host.findMany({ select: { id: true, status: true, lastSeenAt: true } }),
      app.db.tenantEvent.findMany({
        where: { severity: { in: ["error", "critical"] } },
        include: { tenant: { select: { slug: true } } },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      app.db.hostCommand.count({ where: { status: "failed" } }),
      app.db.hostCommand.count({ where: { status: "queued" } }),
      app.db.usageMetric.aggregate({ _sum: { inputTokens: true, outputTokens: true, spendUsd: true } }),
    ]);

    const onlineHosts = hosts.filter(
      (h) => h.status === "online" && h.lastSeenAt && h.lastSeenAt > offlineThreshold,
    ).length;
    const offlineHosts = totalHosts - onlineHosts;

    return {
      tenants: {
        total: totalTenants,
        active: activeTenants,
        suspended: suspendedTenants,
        failed: failedTenants,
        offline: totalTenants - activeTenants,
      },
      hosts: { total: totalHosts, online: onlineHosts, offline: offlineHosts },
      commands: { failed: failedCommands, pending: pendingCommands },
      usage: jsonSafe({
        input_tokens: usageAgg._sum.inputTokens ?? 0,
        output_tokens: usageAgg._sum.outputTokens ?? 0,
        spend_usd: usageAgg._sum.spendUsd ?? 0,
      }),
      recent_errors: jsonSafe(recentErrors),
    };
  });
}
