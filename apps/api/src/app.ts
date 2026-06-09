import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { loadConfig, corsOrigins } from "./config.js";
import { contextPlugin } from "./plugins/context.js";
import { authRoutes } from "./modules/auth/routes.js";
import { tenantRoutes } from "./modules/tenants/routes.js";
import { hostAdminRoutes } from "./modules/hosts/admin.routes.js";
import { hostAgentRoutes } from "./modules/hosts/agent.routes.js";
import { commandRoutes } from "./modules/commands/routes.js";
import { templateRoutes } from "./modules/templates/routes.js";
import { mcpRoutes } from "./modules/mcp/routes.js";
import { memoryRoutes } from "./modules/memory/routes.js";
import { llmRoutes } from "./modules/llm/routes.js";
import { logsRoutes } from "./modules/logs/routes.js";
import { backupRoutes } from "./modules/backups/routes.js";
import { dashboardRoutes } from "./modules/dashboard/routes.js";
import { settingsRoutes } from "./modules/settings/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const config = loadConfig();
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === "production" ? "info" : "debug",
      transport:
        config.NODE_ENV === "production"
          ? undefined
          : { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } },
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, { origin: corsOrigins(config), credentials: true });

  await app.register(swagger, {
    openapi: {
      info: { title: "XoomAgent Control Platform API", version: "0.1.0" },
      servers: [{ url: config.API_PUBLIC_URL }],
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  await app.register(contextPlugin);

  app.get("/health", async () => ({ status: "ok", ts: new Date().toISOString() }));

  // Admin / operator API
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(tenantRoutes, { prefix: "/api/tenants" });
  await app.register(hostAdminRoutes, { prefix: "/api/hosts" });
  await app.register(commandRoutes, { prefix: "/api/commands" });
  await app.register(templateRoutes, { prefix: "/api/agent-templates" });
  await app.register(mcpRoutes, { prefix: "/api/mcp" });
  await app.register(memoryRoutes, { prefix: "/api/memory" });
  await app.register(llmRoutes, { prefix: "/api/llm" });
  await app.register(logsRoutes, { prefix: "/api" });
  await app.register(backupRoutes, { prefix: "/api/backups" });
  await app.register(dashboardRoutes, { prefix: "/api/dashboard" });
  await app.register(settingsRoutes, { prefix: "/api/settings" });

  // Host agent API (outbound from hosts). Registration is token-gated; the rest
  // is host-credential gated inside the plugin.
  await app.register(hostAgentRoutes, { prefix: "/api/hosts" });

  app.setErrorHandler((err: Error & { validation?: unknown; statusCode?: number }, req, reply) => {
    if (err.validation) {
      return reply.code(400).send({ error: "validation_error", message: err.message, details: err.validation });
    }
    req.log.error(err);
    const status = err.statusCode ?? 500;
    return reply.code(status).send({ error: status >= 500 ? "internal_error" : "error", message: err.message });
  });

  return app;
}
