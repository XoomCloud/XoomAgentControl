import { z } from "zod";
import { CommandType, CommandStatus, HostStatus } from "./enums.js";

// ──────────────────────────────────────────────────────────────────────────
// Host Agent Contract
// All connections are initiated OUTBOUND by the host agent. The control plane
// never connects to the host.
// ──────────────────────────────────────────────────────────────────────────

export const HostCapabilities = z.object({
  kvm: z.boolean().default(false),
  firecracker: z.boolean().default(false),
  nftables: z.boolean().default(false),
  docker: z.boolean().default(false),
});
export type HostCapabilities = z.infer<typeof HostCapabilities>;

export const HostResources = z.object({
  total_cpu: z.number().int().nonnegative(),
  total_ram_mb: z.number().int().nonnegative(),
  total_disk_gb: z.number().int().nonnegative(),
});
export type HostResources = z.infer<typeof HostResources>;

// POST /api/hosts/register
export const RegisterHostRequest = z.object({
  host_name: z.string().min(1),
  provider: z.string().default("hetzner"),
  location: z.string().optional(),
  public_ip: z.string().optional(),
  private_ip: z.string().optional(),
  host_agent_version: z.string(),
  firecracker_version: z.string().optional(),
  capabilities: HostCapabilities,
  resources: HostResources,
});
export type RegisterHostRequest = z.infer<typeof RegisterHostRequest>;

export const RegisterHostResponse = z.object({
  host_id: z.string(),
  // Long-lived credential issued to the agent. Presented as a bearer token on
  // all subsequent calls. Returned exactly once.
  agent_key: z.string(),
  approved: z.boolean(),
  heartbeat_interval_seconds: z.number().int().positive(),
});
export type RegisterHostResponse = z.infer<typeof RegisterHostResponse>;

// POST /api/hosts/:host_id/heartbeat
export const RunningMicrovm = z.object({
  tenant_id: z.string(),
  status: z.string(),
  vcpu: z.number().int().optional(),
  ram_mb: z.number().int().optional(),
  disk_gb: z.number().int().optional(),
});
export type RunningMicrovm = z.infer<typeof RunningMicrovm>;

export const HeartbeatRequest = z.object({
  status: HostStatus.default("online"),
  resources: z.object({
    cpu_usage: z.number().min(0).max(100).optional(),
    ram_usage: z.number().min(0).max(100).optional(),
    disk_usage: z.number().min(0).max(100).optional(),
  }),
  running_microvms: z.array(RunningMicrovm).default([]),
  firecracker_status: z.string().optional(),
  agent_status: z.string().optional(),
  host_agent_version: z.string().optional(),
});
export type HeartbeatRequest = z.infer<typeof HeartbeatRequest>;

export const HeartbeatResponse = z.object({
  ok: z.literal(true),
  // The control plane can ask the host to drain / enter maintenance via the
  // heartbeat response without a separate command.
  desired_status: HostStatus.optional(),
  pending_commands: z.number().int().nonnegative().default(0),
});
export type HeartbeatResponse = z.infer<typeof HeartbeatResponse>;

// GET /api/hosts/:host_id/commands/next
export const NextCommandResponse = z
  .object({
    command_id: z.string(),
    command_type: CommandType,
    tenant_id: z.string().nullable(),
    payload: z.record(z.unknown()),
  })
  .nullable();
export type NextCommandResponse = z.infer<typeof NextCommandResponse>;

// POST /api/hosts/:host_id/commands/:command_id/result
export const CommandResultRequest = z.object({
  status: z.enum(["running", "succeeded", "failed"]),
  message: z.string().optional(),
  result: z.record(z.unknown()).optional(),
  error: z.string().optional(),
});
export type CommandResultRequest = z.infer<typeof CommandResultRequest>;

// POST /api/hosts/:host_id/logs  (log + event forwarding from the host/tenant)
export const ForwardLogsRequest = z.object({
  tenant_id: z.string().optional(),
  events: z
    .array(
      z.object({
        event_type: z.string(),
        severity: z.enum(["debug", "info", "warning", "error", "critical"]).default("info"),
        message: z.string(),
        metadata: z.record(z.unknown()).optional(),
        ts: z.string().datetime().optional(),
      }),
    )
    .min(1),
});
export type ForwardLogsRequest = z.infer<typeof ForwardLogsRequest>;

// ──────────────────────────────────────────────────────────────────────────
// create_tenant command payload (control plane -> host agent)
// ──────────────────────────────────────────────────────────────────────────
export const CreateTenantCommandPayload = z.object({
  tenant_slug: z.string(),
  tenant_name: z.string().optional(),
  runtime: z.string().default("swarmclaw"),
  runtime_version: z.string().default("latest"),
  resources: z.object({
    vcpu: z.number().int().positive(),
    ram_mb: z.number().int().positive(),
    disk_gb: z.number().int().positive(),
  }),
  llm: z
    .object({
      provider: z.string().default("litellm"),
      base_url: z.string().url(),
      virtual_key_secret_ref: z.string(),
      model_allowlist: z.array(z.string()).optional(),
    })
    .optional(),
  memory: z
    .object({
      provider: z.string().default("supermemory"),
      namespace: z.string(),
      api_key_secret_ref: z.string().optional(),
    })
    .optional(),
  mcp: z
    .object({
      enabled_servers: z.array(z.string()).default([]),
    })
    .optional(),
  webhook_callback_url: z.string().url().optional(),
  log_forward_url: z.string().url().optional(),
});
export type CreateTenantCommandPayload = z.infer<typeof CreateTenantCommandPayload>;
