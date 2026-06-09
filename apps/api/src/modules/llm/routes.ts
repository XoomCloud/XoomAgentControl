import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { LlmConfigInput, AUDIT_ACTIONS } from "@xoom/shared-types";
import { recordAudit } from "../../lib/audit.js";

const TenantParam = z.object({ tenant_id: z.string() });

export async function llmRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Gateway-level info
  app.get("/gateway", { preHandler: app.requireUser(), schema: { tags: ["llm"] } }, async () => {
    return { provider: "litellm", base_url: app.config.LITELLM_BASE_URL, configured: Boolean(app.config.LITELLM_ADMIN_KEY) };
  });

  // Per-tenant LLM config (virtual key reference, allowlist, budget, limits)
  app.get("/tenants/:tenant_id", { preHandler: app.requireUser(), schema: { params: TenantParam, tags: ["llm"] } }, async (req, reply) => {
    const cfg = await app.db.tenantRuntimeConfig.findUnique({ where: { tenantId: req.params.tenant_id } });
    if (!cfg) return reply.code(404).send({ error: "not_found" });
    return { llm: cfg.llmConfigJson ?? { provider: "litellm" } };
  });

  app.put("/tenants/:tenant_id", { preHandler: app.requireUser({ write: true }), schema: { params: TenantParam, body: LlmConfigInput, tags: ["llm"] } }, async (req) => {
    const { tenant_id } = req.params;
    const b = req.body;
    const cfg = await app.db.tenantRuntimeConfig.findUnique({ where: { tenantId: tenant_id } });
    const current = (cfg?.llmConfigJson ?? {}) as Record<string, unknown>;

    if (current.virtual_key_name) {
      await app.llm.updateVirtualKey(String(current.virtual_key_name), {
        modelAllowlist: b.model_allowlist,
        maxBudgetUsd: b.max_monthly_spend,
        rpmLimit: b.rate_limit_rpm,
      });
    }

    const next = {
      ...current,
      base_url: b.base_url ?? current.base_url ?? app.config.LITELLM_BASE_URL,
      model_allowlist: b.model_allowlist ?? current.model_allowlist ?? [],
      max_monthly_spend: b.max_monthly_spend ?? current.max_monthly_spend ?? 0,
      rate_limit_rpm: b.rate_limit_rpm ?? current.rate_limit_rpm ?? null,
      fallback_models: b.fallback_models ?? current.fallback_models ?? [],
    };
    await app.db.tenantRuntimeConfig.update({ where: { tenantId: tenant_id }, data: { llmConfigJson: next } });

    await recordAudit(app.db, { actorUserId: req.user!.id, ipAddress: req.ip }, AUDIT_ACTIONS.LLM_BUDGET_CHANGED, {
      targetType: "tenant",
      targetId: tenant_id,
      metadata: { max_monthly_spend: next.max_monthly_spend },
    });
    return { llm: next };
  });

  // Pull live spend for a tenant from the gateway.
  app.get("/tenants/:tenant_id/spend", { preHandler: app.requireUser(), schema: { params: TenantParam, tags: ["llm"] } }, async (req) => {
    const cfg = await app.db.tenantRuntimeConfig.findUnique({ where: { tenantId: req.params.tenant_id } });
    const keyName = (cfg?.llmConfigJson as Record<string, unknown> | null)?.virtual_key_name;
    if (!keyName) return { spend: null };
    const spend = await app.llm.getSpend(String(keyName));
    return { spend };
  });
}
