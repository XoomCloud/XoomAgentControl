import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { AgentTemplateInput } from "@xoom/shared-types";
import { jsonSafe } from "../../lib/serialize.js";
import { asJson } from "../../lib/json.js";

const IdParam = z.object({ id: z.string() });

export async function templateRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/", { preHandler: app.requireUser(), schema: { tags: ["agent-templates"] } }, async () => {
    const templates = await app.db.agentTemplate.findMany({ orderBy: { name: "asc" } });
    return { templates: jsonSafe(templates) };
  });

  app.get("/:id", { preHandler: app.requireUser(), schema: { params: IdParam, tags: ["agent-templates"] } }, async (req, reply) => {
    const template = await app.db.agentTemplate.findUnique({ where: { id: req.params.id } });
    if (!template) return reply.code(404).send({ error: "not_found" });
    return { template: jsonSafe(template) };
  });

  app.post("/", { preHandler: app.requireUser({ write: true }), schema: { body: AgentTemplateInput, tags: ["agent-templates"] } }, async (req, reply) => {
    const b = req.body;
    const template = await app.db.agentTemplate.create({
      data: {
        name: b.name,
        description: b.description,
        defaultSystemPrompt: b.default_system_prompt,
        skillsJson: asJson(b.skills ?? []),
        schedulesJson: asJson(b.schedules ?? []),
        mcpToolsJson: asJson(b.mcp_tools ?? []),
        memoryPolicyJson: asJson(b.memory_policy ?? {}),
        llmPolicyJson: asJson(b.llm_policy ?? {}),
      },
    });
    return reply.code(201).send({ template: jsonSafe(template) });
  });

  app.patch("/:id", { preHandler: app.requireUser({ write: true }), schema: { params: IdParam, body: AgentTemplateInput.partial(), tags: ["agent-templates"] } }, async (req, reply) => {
    const b = req.body;
    const template = await app.db.agentTemplate.update({
      where: { id: req.params.id },
      data: {
        name: b.name,
        description: b.description,
        defaultSystemPrompt: b.default_system_prompt,
        skillsJson: asJson(b.skills),
        schedulesJson: asJson(b.schedules),
        mcpToolsJson: asJson(b.mcp_tools),
        memoryPolicyJson: asJson(b.memory_policy),
        llmPolicyJson: asJson(b.llm_policy),
      },
    });
    return { template: jsonSafe(template) };
  });

  app.delete("/:id", { preHandler: app.requireUser({ write: true }), schema: { params: IdParam, tags: ["agent-templates"] } }, async (req) => {
    await app.db.agentTemplate.delete({ where: { id: req.params.id } });
    return { ok: true };
  });
}
