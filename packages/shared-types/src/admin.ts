import { z } from "zod";
import {
  TenantStatus,
  CommandType,
  McpTransport,
  McpRiskLevel,
  SecretProvider,
  UserRole,
} from "./enums.js";

// ──────────────────────────────────────────────────────────────────────────
// Admin / operator API contracts
// ──────────────────────────────────────────────────────────────────────────

// --- Auth ---
export const LoginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const LoginResponse = z.object({
  token: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string().nullable(),
    role: UserRole,
  }),
});
export type LoginResponse = z.infer<typeof LoginResponse>;

// --- Tenants ---
export const ResourceLimits = z.object({
  vcpu: z.number().int().positive().default(2),
  ram_mb: z.number().int().positive().default(4096),
  disk_gb: z.number().int().positive().default(40),
  max_agents: z.number().int().positive().default(5),
  max_monthly_spend: z.number().nonnegative().default(0),
  max_tokens_per_day: z.number().int().nonnegative().default(0),
  max_mcp_tools: z.number().int().nonnegative().default(10),
});
export type ResourceLimits = z.infer<typeof ResourceLimits>;

export const CreateTenantRequest = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "slug must be lowercase alphanumeric with dashes"),
  runtime_type: z.string().default("swarmclaw"),
  runtime_version: z.string().default("latest"),
  domain: z.string().optional(),
  // Either pin a host or let the scheduler auto-select one with capacity.
  assigned_host_id: z.string().nullable().optional(),
  auto_select_host: z.boolean().default(true),
  resource_limits: ResourceLimits.partial().optional(),
  agent_template_id: z.string().optional(),
  mcp_servers: z.array(z.string()).default([]),
  memory: z
    .object({
      provider: z.string().default("supermemory"),
      namespace: z.string().optional(),
    })
    .optional(),
  llm: z
    .object({
      base_url: z.string().optional(),
      model_allowlist: z.array(z.string()).optional(),
      max_monthly_spend: z.number().nonnegative().optional(),
      rate_limit_rpm: z.number().int().optional(),
      fallback_models: z.array(z.string()).optional(),
    })
    .optional(),
});
export type CreateTenantRequest = z.infer<typeof CreateTenantRequest>;

export const UpdateTenantRequest = CreateTenantRequest.partial().omit({ slug: true });
export type UpdateTenantRequest = z.infer<typeof UpdateTenantRequest>;

// Lifecycle actions exposed on the tenant detail page.
export const TenantAction = z.enum([
  "start",
  "stop",
  "restart",
  "backup",
  "update_runtime",
  "suspend",
  "delete",
]);
export type TenantAction = z.infer<typeof TenantAction>;

export const TenantActionRequest = z.object({
  action: TenantAction,
  runtime_version: z.string().optional(),
});
export type TenantActionRequest = z.infer<typeof TenantActionRequest>;

// --- Hosts (operator-side) ---
export const ApproveHostRequest = z.object({
  approved: z.boolean().default(true),
});
export type ApproveHostRequest = z.infer<typeof ApproveHostRequest>;

export const HostMaintenanceRequest = z.object({
  status: z.enum(["maintenance", "draining", "online"]),
});
export type HostMaintenanceRequest = z.infer<typeof HostMaintenanceRequest>;

// --- Manual command creation (deployments page: retry, etc.) ---
export const CreateCommandRequest = z.object({
  host_id: z.string(),
  tenant_id: z.string().nullable().optional(),
  command_type: CommandType,
  payload: z.record(z.unknown()).optional(),
});
export type CreateCommandRequest = z.infer<typeof CreateCommandRequest>;

// --- Agent templates ---
export const AgentTemplateInput = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  default_system_prompt: z.string().optional(),
  skills: z.array(z.string()).optional(),
  schedules: z.array(z.record(z.unknown())).optional(),
  mcp_tools: z.array(z.string()).optional(),
  memory_policy: z.record(z.unknown()).optional(),
  llm_policy: z.record(z.unknown()).optional(),
});
export type AgentTemplateInput = z.infer<typeof AgentTemplateInput>;

// --- MCP registry ---
export const McpServerInput = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  transport: McpTransport.default("http"),
  endpoint: z.string().optional(),
  auth_type: z.string().optional(),
  required_secrets: z.array(z.string()).optional(),
  risk_level: McpRiskLevel.default("medium"),
  approval_required: z.boolean().default(true),
  enabled: z.boolean().default(true),
});
export type McpServerInput = z.infer<typeof McpServerInput>;

export const TenantMcpAccessInput = z.object({
  mcp_server_id: z.string(),
  enabled: z.boolean(),
  agent_scope: z.array(z.string()).optional(),
  approved: z.boolean().optional(),
});
export type TenantMcpAccessInput = z.infer<typeof TenantMcpAccessInput>;

// --- Secrets ---
export const CreateSecretRequest = z.object({
  tenant_id: z.string().nullable().optional(),
  name: z.string().min(1),
  provider: SecretProvider.default("local"),
  // For local provider: the raw value to be envelope-encrypted at rest.
  value: z.string().optional(),
  // For external providers: the reference/path in the external store.
  external_secret_ref: z.string().optional(),
});
export type CreateSecretRequest = z.infer<typeof CreateSecretRequest>;

// --- LLM gateway ---
export const LlmConfigInput = z.object({
  base_url: z.string().optional(),
  model_allowlist: z.array(z.string()).optional(),
  max_monthly_spend: z.number().nonnegative().optional(),
  rate_limit_rpm: z.number().int().optional(),
  fallback_models: z.array(z.string()).optional(),
});
export type LlmConfigInput = z.infer<typeof LlmConfigInput>;

// --- Memory ---
export const MemoryConfigInput = z.object({
  provider: z.string().default("supermemory"),
  namespace: z.string().optional(),
  retention_days: z.number().int().optional(),
  enabled: z.boolean().default(true),
});
export type MemoryConfigInput = z.infer<typeof MemoryConfigInput>;

// --- Users / RBAC ---
export const CreateUserRequest = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  password: z.string().min(8),
  role: UserRole.default("support_engineer"),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequest>;

// --- Common list query ---
export const ListQuery = z.object({
  status: TenantStatus.optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListQuery = z.infer<typeof ListQuery>;
