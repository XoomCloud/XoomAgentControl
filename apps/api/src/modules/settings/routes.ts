import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { AUDIT_ACTIONS } from "@xoom/shared-types";
import { hasRole } from "@xoom/auth";
import { recordAudit } from "../../lib/audit.js";

const KeyParam = z.object({ key: z.string() });

/** Platform settings (key/value). Read by all; written by msp_admin+. */
export async function settingsRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/", { preHandler: app.requireUser(), schema: { tags: ["settings"] } }, async () => {
    const settings = await app.db.platformSetting.findMany();
    return { settings: Object.fromEntries(settings.map((s) => [s.key, s.valueJson])) };
  });

  app.put("/:key", { preHandler: app.requireUser({ write: true }), schema: { params: KeyParam, body: z.record(z.unknown()), tags: ["settings"] } }, async (req, reply) => {
    if (!hasRole(req.user!.role, "msp_admin")) return reply.code(403).send({ error: "forbidden" });
    const setting = await app.db.platformSetting.upsert({
      where: { key: req.params.key },
      update: { valueJson: req.body as object },
      create: { key: req.params.key, valueJson: req.body as object },
    });
    await recordAudit(app.db, { actorUserId: req.user!.id, ipAddress: req.ip }, AUDIT_ACTIONS.SETTINGS_CHANGED, {
      targetType: "setting",
      targetId: req.params.key,
    });
    return { setting };
  });
}
