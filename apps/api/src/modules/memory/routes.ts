import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { MemoryConfigInput } from "@xoom/shared-types";

const TenantParam = z.object({ tenant_id: z.string() });

export async function memoryRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/tenants/:tenant_id", { preHandler: app.requireUser(), schema: { params: TenantParam, tags: ["memory"] } }, async (req, reply) => {
    const cfg = await app.db.tenantRuntimeConfig.findUnique({ where: { tenantId: req.params.tenant_id } });
    if (!cfg) return reply.code(404).send({ error: "not_found" });
    return { memory: cfg.memoryConfigJson ?? { provider: "supermemory", enabled: false } };
  });

  app.put("/tenants/:tenant_id", { preHandler: app.requireUser({ write: true }), schema: { params: TenantParam, body: MemoryConfigInput, tags: ["memory"] } }, async (req) => {
    const { tenant_id } = req.params;
    const b = req.body;
    const namespace = b.namespace ?? tenant_id;
    await app.memory.ensureNamespace({ namespace, retentionDays: b.retention_days });
    const memoryConfig = {
      provider: b.provider,
      namespace,
      retention_days: b.retention_days ?? null,
      enabled: b.enabled,
    };
    await app.db.tenantRuntimeConfig.update({
      where: { tenantId: tenant_id },
      data: { memoryConfigJson: memoryConfig },
    });
    return { memory: memoryConfig };
  });
}
