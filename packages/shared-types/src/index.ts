export * from "./enums.js";
export * from "./host-agent.js";
export * from "./admin.js";

// Canonical audit action names. Every mutating admin action emits one of these.
export const AUDIT_ACTIONS = {
  TENANT_CREATED: "tenant.created",
  TENANT_UPDATED: "tenant.updated",
  TENANT_SUSPENDED: "tenant.suspended",
  TENANT_DELETED: "tenant.deleted",
  TENANT_ACTION: "tenant.action",
  HOST_REGISTERED: "host.registered",
  HOST_APPROVED: "host.approved",
  HOST_MAINTENANCE: "host.maintenance",
  COMMAND_CREATED: "command.created",
  COMMAND_EXECUTED: "command.executed",
  COMMAND_RETRIED: "command.retried",
  SECRET_CHANGED: "secret.changed",
  MCP_ENABLED: "mcp.enabled",
  MCP_DISABLED: "mcp.disabled",
  LLM_BUDGET_CHANGED: "llm.budget_changed",
  USER_CREATED: "user.created",
  USER_UPDATED: "user.updated",
  SETTINGS_CHANGED: "settings.changed",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

// Role -> permission helper. Used by both API guards and the web UI.
export const ROLE_RANK: Record<string, number> = {
  read_only_auditor: 0,
  tenant_admin: 1,
  support_engineer: 2,
  msp_admin: 3,
  platform_owner: 4,
};
