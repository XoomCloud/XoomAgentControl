import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { jsonSafe } from "../../lib/serialize.js";

const BackupQuery = z.object({ tenant_id: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

export async function backupRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/", { preHandler: app.requireUser(), schema: { querystring: BackupQuery, tags: ["backups"] } }, async (req) => {
    const where: Record<string, unknown> = {};
    if (req.query.tenant_id) where.tenantId = req.query.tenant_id;
    const backups = await app.db.backup.findMany({
      where,
      include: { tenant: { select: { slug: true, name: true } }, host: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: req.query.limit,
    });
    return { backups: jsonSafe(backups) };
  });
}
