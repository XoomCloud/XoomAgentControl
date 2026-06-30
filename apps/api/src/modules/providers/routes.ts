import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ProviderInput } from "@xoom/shared-types";
import { jsonSafe } from "../../lib/serialize.js";

const IdParam = z.object({ id: z.string() });

/** LLM provider registry + live health/cost. Registered at /api/providers. */
export async function providerRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/", { preHandler: app.requireUser(), schema: { tags: ["providers"] } }, async () => {
    const providers = await app.db.provider.findMany({ orderBy: { name: "asc" } });
    // Enrich with rolled-up cost/usage from the telemetry store (last 24h).
    const usage = await app.telemetry.usageSummary({ since: "24h" });
    const byProvider = new Map(usage.by_provider.map((p) => [p.provider, p]));
    const enriched = providers.map((p) => ({
      ...p,
      usage_24h: byProvider.get(p.name) ?? { cost_usd: 0, tokens: 0 },
    }));
    return { providers: jsonSafe(enriched), gateway: { base_url: app.config.LITELLM_BASE_URL, configured: Boolean(app.config.LITELLM_ADMIN_KEY) } };
  });

  app.post("/", { preHandler: app.requireUser({ write: true }), schema: { body: ProviderInput, tags: ["providers"] } }, async (req, reply) => {
    const b = req.body;
    const existing = await app.db.provider.findUnique({ where: { name: b.name } });
    const provider = existing
      ? await app.db.provider.update({ where: { name: b.name }, data: { displayName: b.display_name, baseUrl: b.base_url, enabled: b.enabled } })
      : await app.db.provider.create({ data: { name: b.name, displayName: b.display_name, baseUrl: b.base_url, enabled: b.enabled } });
    return reply.code(201).send({ provider: jsonSafe(provider) });
  });

  // Provider latency time-series (from telemetry).
  app.get("/:id/latency", { preHandler: app.requireUser(), schema: { params: IdParam, querystring: z.object({ since: z.string().optional() }), tags: ["providers"] } }, async (req) => {
    const series = await app.telemetry.queryMetrics({ name: "provider.latency_ms", since: req.query.since, step_seconds: 60, agg: "avg" });
    return { series };
  });
}
