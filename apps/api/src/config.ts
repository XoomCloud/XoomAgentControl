import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().default(4000),
  API_PUBLIC_URL: z.string().default("http://localhost:4000"),
  WEB_PUBLIC_URL: z.string().default("http://localhost:3000"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),

  DATABASE_URL: z.string(),
  REDIS_URL: z.string().optional(),

  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 chars"),
  JWT_EXPIRES_IN: z.string().default("12h"),

  HOST_REGISTRATION_TOKEN: z.string().default("dev-host-registration-token"),

  SECRETS_MASTER_KEY: z.string().optional(),
  SECRETS_PROVIDER: z.string().default("local"),

  LITELLM_BASE_URL: z.string().default("https://llm.xoomagent.local"),
  LITELLM_ADMIN_KEY: z.string().optional(),

  SUPERMEMORY_BASE_URL: z.string().default("https://api.supermemory.ai"),
  SUPERMEMORY_API_KEY: z.string().optional(),

  HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().default(30),
  OFFLINE_THRESHOLD_SECONDS: z.coerce.number().default(90),
});

export type AppConfig = z.infer<typeof EnvSchema>;

let cached: AppConfig | undefined;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  // PaaS platforms (Railway, Render, Fly) inject PORT; honour it if API_PORT
  // isn't explicitly set.
  if (!process.env.API_PORT && process.env.PORT) process.env.API_PORT = process.env.PORT;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration");
  }
  cached = parsed.data;
  return cached;
}

export function corsOrigins(cfg: AppConfig): string[] {
  return cfg.CORS_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
