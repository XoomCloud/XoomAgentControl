# Tenant Lifecycle

This document traces a tenant from creation through every lifecycle action, as
implemented in `apps/api/src/modules/tenants/service.ts` and reconciled in
`apps/api/src/modules/hosts/agent.routes.ts`.

A tenant's `status` moves through:

```
pending ──► provisioning ──► active ──► suspended ──► deleted
                  │             ▲  └──────────┘  (start)
                  └──► failed   │
                                └── (restart)
```

---

## Create-tenant flow

Triggered by `POST /api/tenants` (`CreateTenantRequest`). `TenantService.createTenant`
runs the following steps:

### 1. Validate and create a pending tenant

- Reject if the `slug` already exists (`409`).
- Merge requested `resource_limits` over `DEFAULT_LIMITS`
  (vcpu 2, ram 4096 MB, disk 40 GB, max_agents 5, max_monthly_spend 0,
  max_tokens_per_day 0, max_mcp_tools 10).
- Create the `tenants` row with `status = pending`, plus its
  `tenant_resource_limits`. Emit a `tenant.created` event.

### 2. Host selection / capacity reserve

- If `auto_select_host` (default true) and no `assigned_host_id`, the scheduler
  (`selectHostForTenant`) picks an **online, approved** host whose available
  CPU/RAM/disk all satisfy the request (preferring most free RAM).
- If `assigned_host_id` is given, it is used directly.
- **If no host fits**, the tenant is set to `failed`, a `tenant.schedule_failed`
  error event is recorded, and the call returns
  `{ status: "failed", commandId: null }`.

### 3. Provision LLM virtual key + secret ref + memory namespace

- `llm.createVirtualKey(...)` mints a LiteLLM virtual key (or a placeholder when
  LiteLLM is unconfigured).
- The key is **envelope-encrypted** and stored as a `secrets_references` row
  named `litellm_key` with ref `tenant/<slug>/litellm_key`.
- `memory.ensureNamespace(...)` ensures the Supermemory namespace
  (`memory.namespace` or the slug).
- If `agent_template_id` is supplied, the template is snapshotted into the
  runtime config.

### 4. Persist runtime config

- Create `tenant_runtime_config` with `llmConfigJson` (provider, base_url, the
  virtual-key secret ref, allowlist, budget, rate limit, virtual key name),
  `memoryConfigJson` (provider, namespace, enabled), `mcpConfigJson`
  (`enabled_servers`), plus snapshotted template/skills/schedules.
- Upsert `tenant_mcp_access` rows for each requested MCP server (auto-approved
  only when the server doesn't require approval).

### 5. Assign host, reserve capacity, queue the command

- Update the tenant: `assignedHostId = host`, `status = provisioning`.
- `reserveCapacity` decrements the host's available CPU/RAM/disk pools.
- Enqueue a `create_tenant` `host_commands` row (status `queued`) carrying the
  `CreateTenantCommandPayload`. Emit a `command.queued` event.
- Return `{ tenantId, commandId, status: "provisioning" }`.

### 6. Provisioning on the host (outbound agent)

The host agent claims the command on its next poll, executes it
(`executor.ts` → `firecracker.createMicrovm` + `swarmclaw.installAndStart`),
and reports a result. See `docs/host-agent.md`.

### 7. Reconcile

When the agent posts the terminal result to
`POST /api/hosts/:host_id/commands/:command_id/result`, `reconcileTenant`
updates the tenant status. For `create_tenant`: **succeeded → `active`**,
**failed → `failed`**. If the result includes `runtime_url`, it is stored as the
tenant's `domain`. A `command.result` event is recorded either way.

### `create_tenant` command payload

The enqueued payload conforms to `CreateTenantCommandPayload`
(`packages/shared-types/src/host-agent.ts`):

```json
{
  "tenant_slug": "acme",
  "tenant_name": "Acme Corp",
  "runtime": "swarmclaw",
  "runtime_version": "latest",
  "resources": { "vcpu": 2, "ram_mb": 4096, "disk_gb": 40 },
  "llm": {
    "provider": "litellm",
    "base_url": "https://llm.xoomagent.local",
    "virtual_key_secret_ref": "tenant/acme/litellm_key",
    "model_allowlist": []
  },
  "memory": { "provider": "supermemory", "namespace": "acme" },
  "mcp": { "enabled_servers": ["filesystem"] },
  "webhook_callback_url": "http://localhost:4000/api/tenants/<tenant_id>/callback",
  "log_forward_url": "http://localhost:4000/api/hosts/<host_id>/logs"
}
```

The `webhook_callback_url` lets the running SwarmClaw runtime post events back
(`POST /api/tenants/:id/callback`), and `log_forward_url` is where the host
agent forwards tenant logs.

---

## Lifecycle actions

Triggered by `POST /api/tenants/:id/actions` (`TenantActionRequest`). Each action
maps to a host command type and, where applicable, an immediate tenant status
change (`runAction` map in `service.ts`). A command is only enqueued when the
tenant has an `assignedHostId`.

| Action           | Command enqueued  | Immediate tenant status | Notes                                                          |
| ---------------- | ----------------- | ----------------------- | ------------------------------------------------------------- |
| `start`          | `start_tenant`    | `active`                |                                                              |
| `stop`           | `stop_tenant`     | `suspended`             |                                                              |
| `restart`        | `restart_tenant`  | (unchanged)             | Status driven on result reconcile (→ `active`).              |
| `backup`         | `backup_tenant`   | (unchanged)             | Also creates a `pending` `backups` row.                      |
| `update_runtime` | `update_runtime`  | (unchanged)             | Persists `runtime_version` (uses `runtime_version` body arg). |
| `suspend`        | `stop_tenant`     | `suspended`             | Destructive — requires `msp_admin`+.                         |
| `delete`         | `delete_tenant`   | `deleted`               | Destructive — requires `msp_admin`+. Releases capacity.      |

`delete` and `suspend` are guarded in the route by `canPerformDestructive`
(`msp_admin`+). Every action records a `tenant.<action>` event and an audit log
entry (`TENANT_DELETED`, `TENANT_SUSPENDED`, or `TENANT_ACTION`).

### Status transitions on command result (reconcile)

When the host agent reports a terminal result, `reconcileTenant`
(`agent.routes.ts`) applies (success → status; failure → only `create_tenant`
has a fail target):

| Command          | On success → status | On failure → status |
| ---------------- | ------------------- | ------------------- |
| `create_tenant`  | `active`            | `failed`            |
| `start_tenant`   | `active`            | —                   |
| `restart_tenant` | `active`            | —                   |
| `stop_tenant`    | `suspended`         | —                   |
| `delete_tenant`  | `deleted`           | —                   |

`backup_tenant` is not a status transition: on success the matching `pending`
backup rows are marked `succeeded` with the reported `artifact_path`. A
`runtime_url` in any successful result is stored as the tenant `domain`.

### Capacity release on delete

On `delete`, after enqueuing `delete_tenant` and setting status `deleted`, the
service calls `releaseCapacity` to **return the tenant's reserved
CPU/RAM/disk to the assigned host's available pools** — the inverse of the
reservation made during creation.
