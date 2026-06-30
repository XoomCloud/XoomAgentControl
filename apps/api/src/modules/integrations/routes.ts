import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { IntegrationInput, AUDIT_ACTIONS } from "@xoom/shared-types";
import { recordAudit } from "../../lib/audit.js";
import { jsonSafe } from "../../lib/serialize.js";
import { asJson } from "../../lib/json.js";
import { CONNECTOR_CATALOG } from "./catalog.js";

const IdParam = z.object({ id: z.string() });

/**
 * Integrations / connectors. Plugin-driven: the catalog defines available
 * connector kinds and their config schema; instances are stored here. The UI
 * renders config forms from the catalog so new connectors need no UI changes.
 * Registered at /api/integrations.
 */
export async function integrationRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // The connector catalog (what can be added) — drives the UI.
  app.get("/catalog", { preHandler: app.requireUser(), schema: { tags: ["integrations"] } }, async () => {
    return { catalog: CONNECTOR_CATALOG };
  });

  app.get("/", { preHandler: app.requireUser(), schema: { querystring: z.object({ tenant_id: z.string().optional() }), tags: ["integrations"] } }, async (req) => {
    const where: Record<string, unknown> = {};
    if (req.query.tenant_id) where.tenantId = req.query.tenant_id;
    const integrations = await app.db.integration.findMany({ where, orderBy: { createdAt: "desc" } });
    return { integrations: jsonSafe(integrations) };
  });

  app.post("/", { preHandler: app.requireUser({ write: true }), schema: { body: IntegrationInput.extend({ tenant_id: z.string().nullable().optional() }), tags: ["integrations"] } }, async (req, reply) => {
    const b = req.body;
    const integration = await app.db.integration.create({
      data: {
        kind: b.kind,
        name: b.name,
        tenantId: b.tenant_id ?? null,
        configJson: asJson(b.config) ?? {},
        secretRefs: asJson(b.secret_refs) ?? [],
        enabled: b.enabled,
      },
    });
    await recordAudit(app.db, { actorUserId: req.user!.id, ipAddress: req.ip }, AUDIT_ACTIONS.SETTINGS_CHANGED, {
      targetType: "integration",
      targetId: integration.id,
      metadata: { kind: b.kind, name: b.name },
    });
    return reply.code(201).send({ integration: jsonSafe(integration) });
  });

  app.patch("/:id", { preHandler: app.requireUser({ write: true }), schema: { params: IdParam, body: IntegrationInput.partial(), tags: ["integrations"] } }, async (req) => {
    const b = req.body;
    const integration = await app.db.integration.update({
      where: { id: req.params.id },
      data: {
        name: b.name,
        configJson: asJson(b.config),
        secretRefs: asJson(b.secret_refs),
        enabled: b.enabled,
      },
    });
    return { integration: jsonSafe(integration) };
  });

  app.delete("/:id", { preHandler: app.requireUser({ write: true }), schema: { params: IdParam, tags: ["integrations"] } }, async (req) => {
    await app.db.integration.delete({ where: { id: req.params.id } });
    return { ok: true };
  });
}
