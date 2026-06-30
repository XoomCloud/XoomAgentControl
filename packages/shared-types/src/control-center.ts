import { z } from "zod";

// ──────────────────────────────────────────────────────────────────────────
// Control Center admin contracts: deployed-agent registry, providers,
// integrations (connector instances). Telemetry itself lives in telemetry.ts.
// ──────────────────────────────────────────────────────────────────────────

export const AgentStatus = z.enum(["online", "degraded", "offline", "paused", "error"]);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const RegisterAgentInput = z.object({
  tenant_id: z.string(),
  external_id: z.string(), // id within the tenant runtime (SwarmClaw/OpenClaw)
  name: z.string(),
  runtime_type: z.string().default("swarmclaw"),
  current_llm: z.string().optional(),
  fallback_models: z.array(z.string()).optional(),
  prompt_version: z.string().optional(),
  skill_version: z.string().optional(),
});
export type RegisterAgentInput = z.infer<typeof RegisterAgentInput>;

// Live agent state pushed by the runtime poller on the host.
export const AgentHeartbeat = z.object({
  tenant_id: z.string(),
  external_id: z.string(),
  status: AgentStatus.default("online"),
  health_score: z.number().min(0).max(100).optional(),
  current_task: z.string().nullable().optional(),
  queue_length: z.number().int().optional(),
  running_jobs: z.number().int().optional(),
  response_time_ms: z.number().optional(),
  memory_bytes: z.number().optional(),
  current_llm: z.string().optional(),
});
export type AgentHeartbeat = z.infer<typeof AgentHeartbeat>;

export const AgentAction = z.enum(["restart", "pause", "resume", "clone", "export"]);
export const AgentActionRequest = z.object({ action: AgentAction });
export type AgentActionRequest = z.infer<typeof AgentActionRequest>;

// --- Providers ---
export const ProviderInput = z.object({
  name: z.string(), // openai | anthropic | google | openrouter | groq | mistral | azure-openai | deepseek
  display_name: z.string().optional(),
  base_url: z.string().optional(),
  enabled: z.boolean().default(true),
});
export type ProviderInput = z.infer<typeof ProviderInput>;

// --- Integrations / connector instances (plugin-driven) ---
export const IntegrationKind = z.enum([
  "openclaw", "swarmclaw", "discord", "microsoft365", "google-workspace", "github",
  "openai", "anthropic", "azure", "aws", "hetzner", "cloudflare", "tailscale",
  "grafana", "prometheus", "loki", "uptime-kuma", "quickbooks", "halopsa", "hudu", "custom",
]);
export type IntegrationKind = z.infer<typeof IntegrationKind>;

export const IntegrationInput = z.object({
  kind: IntegrationKind,
  name: z.string(),
  // arbitrary per-connector config; the UI renders this from the connector's schema
  config: z.record(z.unknown()).default({}),
  // references into secrets_references (never raw creds here)
  secret_refs: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});
export type IntegrationInput = z.infer<typeof IntegrationInput>;

// --- Dashboard layouts (dockable/resizable widgets persisted per user) ---
export const WidgetLayout = z.object({
  id: z.string(),
  type: z.string(), // widget component key
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int(),
  h: z.number().int(),
  props: z.record(z.unknown()).optional(),
});
export const DashboardLayout = z.object({
  name: z.string(),
  widgets: z.array(WidgetLayout),
});
export type DashboardLayout = z.infer<typeof DashboardLayout>;

// --- Overview aggregate (extends the old dashboard summary) ---
export type PlatformHealth = "healthy" | "warning" | "critical";
