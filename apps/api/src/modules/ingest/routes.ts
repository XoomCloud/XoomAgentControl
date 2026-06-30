import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { IngestBatch, AgentHeartbeat, RT_TOPICS, METRICS } from "@xoom/shared-types";
import { asJson } from "../../lib/json.js";

const HostParam = z.object({ host_id: z.string() });

/**
 * Telemetry + agent-state ingestion. Outbound-only: host agents POST here using
 * their long-lived host key. Writes to the telemetry store and fans out to
 * realtime websocket topics. Registered under /api/hosts.
 */
export async function ingestRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // POST /api/hosts/:host_id/telemetry  — metrics/logs/spans/usage/conversations
  app.post(
    "/:host_id/telemetry",
    { preHandler: app.requireHost(), schema: { params: HostParam, body: IngestBatch, tags: ["ingest"] } },
    async (req) => {
      const batch = req.body;
      // Force the source host to the authenticated host (don't trust the body).
      batch.source.host_id = req.hostId!;
      batch.source.kind = batch.source.kind ?? "host";

      await app.telemetry.write(batch);

      // Fan out to live subscribers.
      const hostTopic = RT_TOPICS.hostMetrics(req.hostId!);
      for (const m of batch.metrics ?? []) {
        app.rt.publish(hostTopic, "metric", m);
        if (m.name === METRICS.HOST_CPU || m.name === METRICS.HOST_RAM) {
          app.rt.publish(RT_TOPICS.overview, "metric", { host_id: req.hostId, ...m });
        }
        if (batch.source.agent_id) app.rt.publish(RT_TOPICS.agentMetrics(batch.source.agent_id), "metric", m);
      }
      for (const l of batch.logs ?? []) {
        app.rt.publish(RT_TOPICS.hostLogs(req.hostId!), "log", l);
      }
      return { ok: true, accepted: { metrics: batch.metrics?.length ?? 0, logs: batch.logs?.length ?? 0, usage: batch.usage?.length ?? 0 } };
    },
  );

  // POST /api/hosts/:host_id/agents  — live agent state from the runtime poller
  app.post(
    "/:host_id/agents",
    { preHandler: app.requireHost(), schema: { params: HostParam, body: z.array(AgentHeartbeat).min(1), tags: ["ingest"] } },
    async (req) => {
      const beats = req.body;
      for (const b of beats) {
        const agent = await app.db.agent.upsert({
          where: { tenantId_externalId: { tenantId: b.tenant_id, externalId: b.external_id } },
          update: {
            status: b.status,
            healthScore: b.health_score ?? undefined,
            currentTask: b.current_task ?? null,
            currentLlm: b.current_llm ?? undefined,
            queueLength: b.queue_length ?? 0,
            lastSeenAt: new Date(),
          },
          create: {
            tenantId: b.tenant_id,
            externalId: b.external_id,
            name: b.external_id,
            status: b.status,
            healthScore: b.health_score ?? null,
            currentTask: b.current_task ?? null,
            currentLlm: b.current_llm ?? null,
            queueLength: b.queue_length ?? 0,
            lastSeenAt: new Date(),
          },
        });
        // Live agent metrics → telemetry + realtime.
        const ts = Date.now();
        const metrics = [
          b.health_score != null && { name: METRICS.AGENT_HEALTH, value: b.health_score, ts },
          b.response_time_ms != null && { name: METRICS.AGENT_RESPONSE_MS, value: b.response_time_ms, ts },
          b.queue_length != null && { name: METRICS.AGENT_QUEUE, value: b.queue_length, ts },
          b.memory_bytes != null && { name: METRICS.AGENT_MEM, value: b.memory_bytes, ts },
        ].filter(Boolean) as { name: string; value: number; ts: number }[];
        if (metrics.length) {
          await app.telemetry.write({ source: { kind: "agent", host_id: req.hostId!, tenant_id: b.tenant_id, agent_id: agent.id }, metrics });
        }
        app.rt.publish(RT_TOPICS.agent(agent.id), "agent.update", { id: agent.id, ...b });
      }
      return { ok: true, agents: beats.length };
    },
  );
}
