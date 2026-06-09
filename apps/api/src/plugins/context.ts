import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { getPrisma, type Db } from "@xoom/db";
import { verifySession, verifyAgentKey, type SessionUser } from "@xoom/auth";
import { loadConfig, type AppConfig } from "../config.js";
import { LiteLlmGateway, type LlmGateway } from "../lib/providers/llm.js";
import { SupermemoryProvider, type MemoryProvider } from "../lib/providers/memory.js";
import { LocalSecretsProvider, type SecretsProvider } from "../lib/secrets.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    config: AppConfig;
    llm: LlmGateway;
    memory: MemoryProvider;
    secrets: SecretsProvider;
    /** Guard: requires a valid admin session. Optionally enforces write access. */
    requireUser: (opts?: { write?: boolean }) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Guard: authenticates a host agent via its long-lived bearer key. */
    requireHost: () => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user?: SessionUser;
    hostId?: string;
  }
}

export const contextPlugin = fp(async function contextPlugin(app: FastifyInstance) {
  const config = loadConfig();
  const db = getPrisma();

  app.decorate("config", config);
  app.decorate("db", db);
  app.decorate("llm", new LiteLlmGateway(config.LITELLM_BASE_URL, config.LITELLM_ADMIN_KEY));
  app.decorate("memory", new SupermemoryProvider(config.SUPERMEMORY_BASE_URL, config.SUPERMEMORY_API_KEY));
  app.decorate("secrets", new LocalSecretsProvider(config.SECRETS_MASTER_KEY));

  function bearer(req: FastifyRequest): string | null {
    const h = req.headers.authorization;
    if (!h || !h.startsWith("Bearer ")) return null;
    return h.slice("Bearer ".length).trim();
  }

  app.decorate("requireUser", (opts?: { write?: boolean }) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const token = bearer(req);
      if (!token) {
        return reply.code(401).send({ error: "unauthorized", message: "Missing bearer token" });
      }
      try {
        req.user = verifySession(token, config.JWT_SECRET);
      } catch {
        return reply.code(401).send({ error: "unauthorized", message: "Invalid or expired token" });
      }
      if (opts?.write && req.user.role === "read_only_auditor") {
        return reply.code(403).send({ error: "forbidden", message: "Read-only role cannot perform writes" });
      }
    };
  });

  app.decorate("requireHost", () => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const token = bearer(req);
      const hostId = (req.params as { host_id?: string }).host_id;
      if (!token || !hostId) {
        return reply.code(401).send({ error: "unauthorized", message: "Missing host credential" });
      }
      const host = await db.host.findUnique({ where: { id: hostId } });
      if (!host || !host.agentKeyHash || !host.approved) {
        return reply.code(401).send({ error: "unauthorized", message: "Unknown or unapproved host" });
      }
      const ok = await verifyAgentKey(token, host.agentKeyHash);
      if (!ok) {
        return reply.code(401).send({ error: "unauthorized", message: "Invalid host credential" });
      }
      req.hostId = host.id;
    };
  });
});
