import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { MetricQuery, LogQuery } from "@xoom/shared-types";

/** Telemetry query API for the Control Center (admin authed). Registered at /api/telemetry. */
export async function telemetryRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/backend", { preHandler: app.requireUser(), schema: { tags: ["telemetry"] } }, async () => {
    return { backend: app.telemetry.backend };
  });

  app.get("/metrics", { preHandler: app.requireUser(), schema: { querystring: MetricQuery, tags: ["telemetry"] } }, async (req) => {
    return app.telemetry.queryMetrics(req.query);
  });

  app.get("/logs", { preHandler: app.requireUser(), schema: { querystring: LogQuery, tags: ["telemetry"] } }, async (req) => {
    const logs = await app.telemetry.queryLogs(req.query);
    return { logs };
  });

  app.get(
    "/usage",
    { preHandler: app.requireUser(), schema: { querystring: z.object({ since: z.string().optional(), tenant_id: z.string().optional() }), tags: ["telemetry"] } },
    async (req) => {
      return app.telemetry.usageSummary(req.query);
    },
  );

  // Convenience: latest value of a single metric (overview tiles).
  app.get(
    "/latest",
    { preHandler: app.requireUser(), schema: { querystring: z.object({ name: z.string(), host_id: z.string().optional(), agent_id: z.string().optional(), tenant_id: z.string().optional() }), tags: ["telemetry"] } },
    async (req) => {
      const { name, ...filter } = req.query;
      return { name, value: await app.telemetry.latest(name, filter) };
    },
  );
}
