import { z } from "zod";

export const TenantStatus = z.enum([
  "pending",
  "provisioning",
  "active",
  "suspended",
  "failed",
  "deleted",
]);
export type TenantStatus = z.infer<typeof TenantStatus>;

export const HostStatus = z.enum(["online", "offline", "draining", "maintenance"]);
export type HostStatus = z.infer<typeof HostStatus>;

export const CommandType = z.enum([
  "create_tenant",
  "start_tenant",
  "stop_tenant",
  "restart_tenant",
  "delete_tenant",
  "update_runtime",
  "backup_tenant",
  "restore_tenant",
  "collect_logs",
]);
export type CommandType = z.infer<typeof CommandType>;

export const CommandStatus = z.enum([
  "queued",
  "claimed",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export type CommandStatus = z.infer<typeof CommandStatus>;

export const EventSeverity = z.enum(["debug", "info", "warning", "error", "critical"]);
export type EventSeverity = z.infer<typeof EventSeverity>;

export const UserRole = z.enum([
  "platform_owner",
  "msp_admin",
  "support_engineer",
  "read_only_auditor",
  "tenant_admin",
]);
export type UserRole = z.infer<typeof UserRole>;

export const McpTransport = z.enum(["stdio", "http", "sse", "websocket"]);
export type McpTransport = z.infer<typeof McpTransport>;

export const McpRiskLevel = z.enum(["low", "medium", "high", "critical"]);
export type McpRiskLevel = z.infer<typeof McpRiskLevel>;

export const SecretProvider = z.enum(["local", "vault", "infisical", "doppler", "aws"]);
export type SecretProvider = z.infer<typeof SecretProvider>;

export const BackupStatus = z.enum(["pending", "running", "succeeded", "failed"]);
export type BackupStatus = z.infer<typeof BackupStatus>;

// Runtime type is intentionally a loose string with a known default so future
// runtimes (openclaw, langgraph, crewai, custom-docker-runtime) can be added
// without a schema migration.
export const RuntimeType = z
  .string()
  .min(1)
  .default("swarmclaw");
export type RuntimeType = z.infer<typeof RuntimeType>;
