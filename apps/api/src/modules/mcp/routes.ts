import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { McpServerInput, TenantMcpAccessInput, AUDIT_ACTIONS } from "@xoom/shared-types";
import { recordAudit } from "../../lib/audit.js";
import { jsonSafe } from "../../lib/serialize.js";

const IdParam = z.object({ id: z.string() });
const TenantParam = z.object({ tenant_id: z.string() });

export async function mcpRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Registry of approved MCP servers
  app.get("/servers", { preHandler: app.requireUser(), schema: { tags: ["mcp"] } }, async () => {
    const servers = await app.db.mcpServer.findMany({ orderBy: { name: "asc" } });
    return { servers: jsonSafe(servers) };
  });

  app.post("/servers", { preHandler: app.requireUser({ write: true }), schema: { body: McpServerInput, tags: ["mcp"] } }, async (req, reply) => {
    const b = req.body;
    const server = await app.db.mcpServer.create({
      data: {
        name: b.name,
        description: b.description,
        transport: b.transport,
        endpoint: b.endpoint,
        authType: b.auth_type,
        requiredSecrets: b.required_secrets ?? [],
        riskLevel: b.risk_level,
        approvalRequired: b.approval_required,
        enabled: b.enabled,
      },
    });
    return reply.code(201).send({ server: jsonSafe(server) });
  });

  app.patch("/servers/:id", { preHandler: app.requireUser({ write: true }), schema: { params: IdParam, body: McpServerInput.partial(), tags: ["mcp"] } }, async (req) => {
    const b = req.body;
    const server = await app.db.mcpServer.update({
      where: { id: req.params.id },
      data: {
        description: b.description,
        transport: b.transport,
        endpoint: b.endpoint,
        authType: b.auth_type,
        requiredSecrets: b.required_secrets,
        riskLevel: b.risk_level,
        approvalRequired: b.approval_required,
        enabled: b.enabled,
      },
    });
    return { server: jsonSafe(server) };
  });

  // Per-tenant access policy
  app.get("/tenants/:tenant_id/access", { preHandler: app.requireUser(), schema: { params: TenantParam, tags: ["mcp"] } }, async (req) => {
    const access = await app.db.tenantMcpAccess.findMany({
      where: { tenantId: req.params.tenant_id },
      include: { mcpServer: true },
    });
    return { access: jsonSafe(access) };
  });

  app.put("/tenants/:tenant_id/access", { preHandler: app.requireUser({ write: true }), schema: { params: TenantParam, body: TenantMcpAccessInput, tags: ["mcp"] } }, async (req) => {
    const { tenant_id } = req.params;
    const b = req.body;
    const server = await app.db.mcpServer.findUnique({ where: { id: b.mcp_server_id } });
    const access = await app.db.tenantMcpAccess.upsert({
      where: { tenantId_mcpServerId: { tenantId: tenant_id, mcpServerId: b.mcp_server_id } },
      update: { enabled: b.enabled, agentScope: b.agent_scope ?? [], approved: b.approved ?? !server?.approvalRequired },
      create: {
        tenantId: tenant_id,
        mcpServerId: b.mcp_server_id,
        enabled: b.enabled,
        agentScope: b.agent_scope ?? [],
        approved: b.approved ?? !server?.approvalRequired,
      },
    });
    await recordAudit(
      app.db,
      { actorUserId: req.user!.id, ipAddress: req.ip },
      b.enabled ? AUDIT_ACTIONS.MCP_ENABLED : AUDIT_ACTIONS.MCP_DISABLED,
      { targetType: "tenant", targetId: tenant_id, metadata: { mcp_server_id: b.mcp_server_id } },
    );
    return { access: jsonSafe(access) };
  });
}
