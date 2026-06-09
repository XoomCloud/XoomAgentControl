# Architecture

The XoomAgent Control Platform separates a stateful **control plane** from a
fleet of stateless, **outbound-only host agents**. Operators only ever interact
with the control plane; the control plane drives hosts indirectly through a
command queue.

---

## Components

### Control plane (runs on a VPS)

| Component        | Package        | Responsibility                                                      |
| ---------------- | -------------- | ------------------------------------------------------------------ |
| Operator console | `@xoom/web`    | Next.js UI for tenants, hosts, deployments, MCP, secrets, audit.   |
| API              | `@xoom/api`    | Fastify + Zod REST API; OpenAPI at `/docs`. Owns all orchestration. |
| Database         | `@xoom/db`     | PostgreSQL via Prisma — single source of truth for all state.      |
| Cache / queue    | Redis          | Optional cache; `REDIS_URL` is configured but optional.            |
| Shared contracts | `@xoom/shared-types` | Zod schemas shared by API, web, and host agent.             |
| Auth helpers     | `@xoom/auth`   | JWT sessions, bcrypt password + agent-key hashing, RBAC ranks.     |

### Host side (Hetzner dedicated KVM hosts)

| Component   | Package           | Responsibility                                                |
| ----------- | ----------------- | ------------------------------------------------------------- |
| Host agent  | `@xoom/host-agent` | Registers, heartbeats, polls/executes commands, forwards logs. |
| Firecracker | (system)          | KVM-backed MicroVMs, one per tenant.                          |
| SwarmClaw   | (in-VM)           | The default agent runtime running inside each tenant MicroVM.  |

### Shared platform services (consumed by tenants)

- **LiteLLM** — LLM gateway; per-tenant virtual keys with budget/rate limits.
- **Supermemory** — memory provider; per-tenant namespaces.
- **MCP gateway** — registry of MCP servers with per-tenant access policy.

---

## Control-plane ↔ host-agent boundary

The defining property of the design: **hosts expose no inbound management
ports.** Every interaction is initiated **outbound** by the host agent.

```
 Control plane (inbound HTTP API)        Host agent (outbound HTTP client)
 ───────────────────────────────         ─────────────────────────────────
 POST /api/hosts/register         ◄────── register (X-Registration-Token)
 POST /api/hosts/:id/heartbeat    ◄────── heartbeat every 30s (Bearer key)
 GET  /api/hosts/:id/commands/next◄────── poll for queued command (claims it)
 POST /api/hosts/:id/commands/:cid/result ◄ report running / succeeded / failed
 POST /api/hosts/:id/logs         ◄────── forward tenant/host events
```

- The control plane **never connects to a host**. To act on a host it
  **enqueues a `HostCommand`**; the agent claims it on its next poll.
- The heartbeat response can carry a **`desired_status`** (drain/maintenance),
  letting the control plane steer a host without a separate command.
- Authentication: registration is gated by the shared `HOST_REGISTRATION_TOKEN`;
  everything else by the **per-host bearer key**, and only for **approved**
  hosts.

---

## Data model overview

All tables live in PostgreSQL (`packages/db/prisma/schema.prisma`). Grouped by
concern:

### Identity & access

- **`users`** — operator accounts. `role` is a `UserRole`
  (`platform_owner`/`msp_admin`/`support_engineer`/`read_only_auditor`/`tenant_admin`),
  `passwordHash` (bcrypt), `active`, `lastLoginAt`.
- **`audit_logs`** — append-only trail of mutating admin actions: `actorUserId`,
  `action`, `targetType`/`targetId`, `ipAddress`, `metadataJson`.

### Hosts

- **`hosts`** — registered Hetzner/KVM hosts: provider, location, IPs, status
  (`online`/`offline`/`draining`/`maintenance`), agent + Firecracker versions,
  reported `capabilitiesJson` (kvm/firecracker/nftables/docker), total vs
  available CPU/RAM/disk pools, `agentKeyHash` (bcrypt of the per-host key),
  `approved` flag, `lastSeenAt`.
- **`host_heartbeats`** — time series of host metrics: cpu/ram/disk usage,
  running MicroVM count, firecracker/agent status, raw payload.

### Tenants

- **`tenants`** — one row per agent tenant: `slug` (unique), `status`
  (`pending`→`provisioning`→`active`/`suspended`/`failed`/`deleted`),
  `assignedHostId`, `runtimeType` (default `swarmclaw`), `runtimeVersion`,
  `domain`.
- **`tenant_resource_limits`** — per-tenant caps: vcpu, ram_mb, disk_gb,
  max_agents, max_monthly_spend, max_tokens_per_day, max_mcp_tools.
- **`tenant_runtime_config`** — the runtime config snapshot pushed into the VM:
  swarmclaw version plus JSON blobs for bootstrap, environment, agent templates,
  skills, schedules, MCP, memory, and LLM config.

### Command queue (control plane → host agent)

- **`host_commands`** — the work queue: `commandType` (`CommandType`), `status`
  (`queued`→`claimed`→`running`→`succeeded`/`failed`/`cancelled`),
  `payloadJson`, `resultJson`, `errorMessage`, `attempts`, and claim/complete
  timestamps. Indexed by `(hostId, status)` so the agent can claim the oldest
  queued command for its host.

### Events, audit, metrics, observability

- **`tenant_events`** — per-tenant event log with `severity` (`debug`…`critical`),
  `eventType`, `message`, `metadataJson`.
- **`usage_metrics`** — aggregated token/spend windows pulled from the LLM
  gateway (input/output tokens, `spendUsd`, source).
- (`audit_logs` and `host_heartbeats` above complete the observability picture.)

### Secrets, templates, MCP, backups, settings

- **`secrets_references`** — references to secret material. For `provider=local`
  the row carries an **envelope-encrypted** `encryptedValue`; for external
  providers it stores an `externalSecretRef`. Unique per `(tenantId, name)`.
- **`agent_templates`** — reusable agent packs (system prompt, skills,
  schedules, MCP tools, memory/LLM policy).
- **`mcp_servers`** — registry of MCP servers: transport
  (`stdio`/`http`/`sse`/`websocket`), endpoint, auth type, required secrets,
  `riskLevel`, `approvalRequired`, `enabled`.
- **`tenant_mcp_access`** — per-tenant MCP grant: `enabled`, optional
  `agentScope`, `approved`. Unique per `(tenantId, mcpServerId)`.
- **`backups`** — tenant backup jobs: type, artifact path, status
  (`pending`/`running`/`succeeded`/`failed`), size, timestamps.
- **`platform_settings`** — singleton key/value JSON store for platform config.

---

## Provider abstractions

Each external dependency sits behind an interface so the concrete vendor can be
swapped without touching callers.

### LLM gateway — `LlmGateway` (impl: `LiteLlmGateway`)

`createVirtualKey` / `updateVirtualKey` / `getSpend` / `deleteVirtualKey`.
The LiteLLM impl talks to LiteLLM's admin API (`/key/generate`, `/key/update`,
`/key/info`, `/key/delete`). When `LITELLM_ADMIN_KEY` is unset (dev/MVP) it
returns a deterministic placeholder key so provisioning still completes.

### Memory provider — `MemoryProvider` (impl: `SupermemoryProvider`)

`ensureNamespace` / `deleteNamespace`. Supermemory namespaces are created lazily
on first write; the MVP impl echoes the namespace back so it can be carried into
the tenant config.

### Secrets provider — `SecretsProvider` (impl: `LocalSecretsProvider`)

`store` / `resolve`. The local impl uses **AES-256-GCM** envelope encryption
under `SECRETS_MASTER_KEY` (ciphertext format `v1:<iv>:<tag>:<ciphertext>`,
all base64). The `SecretProvider` enum reserves `vault`/`infisical`/`doppler`/
`aws` for future backends.

### Host scheduler — `lib/scheduler.ts`

`selectHostForTenant` picks an **online, approved** host whose available
CPU/RAM/disk all satisfy the request, preferring the host with the most free RAM
(simple hot-spot avoidance). `reserveCapacity` / `releaseCapacity` atomically
decrement/increment the host's available pools. Provider-agnostic — works for
any host regardless of cloud.

---

## Runtime abstraction

`Tenant.runtimeType` is a **plain string** with a default of `swarmclaw`
(`RuntimeType` Zod schema). This is deliberate: new runtimes
(`openclaw`, `langgraph`, `crewai`, `custom`) can be introduced **without a
schema migration**. The `create_tenant` command payload carries `runtime` and
`runtime_version` so the host agent can install the right runtime per tenant.
The default agent runtime inside the MicroVM is **SwarmClaw**.

---

## Observability — now vs later

Today, all signals are stored in **PostgreSQL**:

- **Events** → `tenant_events`
- **Audit** → `audit_logs`
- **Usage/spend** → `usage_metrics`
- **Heartbeats / host metrics** → `host_heartbeats`

> **Later:** high-volume logs and metrics are expected to move to dedicated
> stores — **Loki** for logs and **ClickHouse** for metrics — with Postgres
> retaining the authoritative relational state. The event/log forwarding path
> (`POST /api/hosts/:id/logs`) is designed to be re-pointed at those backends
> without changing the host-agent contract.
