# API Reference

The control-plane REST API is built with Fastify + Zod. Request/response shapes
are defined as Zod schemas in `@xoom/shared-types` and are the source of truth.

**OpenAPI / Swagger** is auto-generated from those Zod schemas (via
`fastify-type-provider-zod` + `@fastify/swagger`) and served interactively at
**`/docs`** (e.g. `http://localhost:4000/docs`).

## Authentication

| Auth kind        | How                                                                 |
| ---------------- | ------------------------------------------------------------------- |
| **Admin JWT**    | `Authorization: Bearer <jwt>` from `POST /api/auth/login`. Guard `requireUser`. Write routes use `requireUser({ write: true })` (blocks `read_only_auditor`). Some routes additionally enforce `msp_admin`+. |
| **Host-agent key** | `Authorization: Bearer <agent_key>`. Guard `requireHost` — host must exist and be **approved**. |
| **Registration token** | `X-Registration-Token: <HOST_REGISTRATION_TOKEN>` — register only. |
| **Public**       | No auth.                                                            |

Errors are JSON `{ "error": "...", "message": "..." }`; validation failures
return `400 validation_error` with `details`.

---

## Health

| Method | Path      | Auth   | Description                  |
| ------ | --------- | ------ | --------------------------- |
| GET    | `/health` | Public | Liveness — `{ status, ts }`. |

## Auth — `/api/auth`

| Method | Path     | Auth                | Body                | Description                                        |
| ------ | -------- | ------------------- | ------------------- | ------------------------------------------------- |
| POST   | `/login` | Public              | `LoginRequest`      | Authenticate; returns JWT + user (`LoginResponse`). |
| GET    | `/me`    | Admin JWT           | —                   | Current session user.                              |
| GET    | `/users` | Admin JWT (`msp_admin`+) | —              | List operator users.                               |
| POST   | `/users` | Admin JWT write (`msp_admin`+) | `CreateUserRequest` | Create an operator user.                  |

## Tenants — `/api/tenants`

| Method | Path             | Auth                      | Body                  | Description                                              |
| ------ | ---------------- | ------------------------- | --------------------- | ------------------------------------------------------- |
| GET    | `/`              | Admin JWT                 | `ListQuery` (query)   | List tenants (filter by status/`q`, paginated).         |
| GET    | `/:id`           | Admin JWT                 | —                     | Tenant detail (host, limits, config, MCP, events, etc). |
| POST   | `/`              | Admin JWT write           | `CreateTenantRequest` | Create tenant + run full provisioning flow.             |
| PATCH  | `/:id`           | Admin JWT write           | `UpdateTenantRequest` | Edit metadata / resource limits.                        |
| POST   | `/:id/actions`   | Admin JWT write (delete/suspend: `msp_admin`+) | `TenantActionRequest` | Lifecycle action (start/stop/restart/backup/update_runtime/suspend/delete). |
| GET    | `/:id/health`    | Admin JWT                 | —                     | Health summary (status, runtime, host, last error).     |
| POST   | `/:id/callback`  | Public                    | JSON object           | Runtime callback (SwarmClaw → control plane webhook).   |

## Hosts — `/api/hosts`

### Operator (admin) routes

| Method | Path               | Auth                          | Body                     | Description                                  |
| ------ | ------------------ | ----------------------------- | ------------------------ | ------------------------------------------- |
| GET    | `/`                | Admin JWT                     | —                        | List hosts with derived online/offline.     |
| GET    | `/:id`             | Admin JWT                     | —                        | Host detail (capacity, VMs, heartbeats).    |
| GET    | `/:id/logs`        | Admin JWT                     | —                        | Recent heartbeat stream for the host.       |
| POST   | `/:id/approve`     | Admin JWT write (`msp_admin`+) | `ApproveHostRequest`     | Approve/unapprove a registered host.        |
| POST   | `/:id/maintenance` | Admin JWT write               | `HostMaintenanceRequest` | Set host maintenance/draining/online.       |

### Host-agent routes (outbound from hosts)

| Method | Path                                | Auth               | Body                  | Description                          |
| ------ | ----------------------------------- | ------------------ | --------------------- | ----------------------------------- |
| POST   | `/register`                         | Registration token | `RegisterHostRequest` | Register host; returns `agent_key`. |
| POST   | `/:host_id/heartbeat`               | Host-agent key     | `HeartbeatRequest`    | Heartbeat + status; returns pending count. |
| GET    | `/:host_id/commands/next`           | Host-agent key     | —                     | Claim oldest queued command (`NextCommandResponse`). |
| POST   | `/:host_id/commands/:command_id/result` | Host-agent key | `CommandResultRequest` | Report command running/terminal result. |
| POST   | `/:host_id/logs`                    | Host-agent key     | `ForwardLogsRequest`  | Forward tenant/host events.          |

## Commands — `/api/commands`

| Method | Path         | Auth            | Body                  | Description                               |
| ------ | ------------ | --------------- | --------------------- | ----------------------------------------- |
| GET    | `/`          | Admin JWT       | query (status/host/tenant) | List commands across hosts (deployments). |
| GET    | `/:id`       | Admin JWT       | —                     | Command detail.                           |
| POST   | `/`          | Admin JWT write | `CreateCommandRequest` | Manually enqueue a command.              |
| POST   | `/:id/retry` | Admin JWT write | —                     | Re-queue a fresh copy of a command.       |

## Agent templates — `/api/agent-templates`

| Method | Path   | Auth            | Body                          | Description              |
| ------ | ------ | --------------- | ----------------------------- | ----------------------- |
| GET    | `/`    | Admin JWT       | —                             | List templates.         |
| GET    | `/:id` | Admin JWT       | —                             | Template detail.        |
| POST   | `/`    | Admin JWT write | `AgentTemplateInput`          | Create template.        |
| PATCH  | `/:id` | Admin JWT write | `AgentTemplateInput` (partial) | Update template.       |
| DELETE | `/:id` | Admin JWT write | —                             | Delete template.        |

## MCP — `/api/mcp`

| Method | Path                            | Auth            | Body                       | Description                          |
| ------ | ------------------------------- | --------------- | -------------------------- | ----------------------------------- |
| GET    | `/servers`                      | Admin JWT       | —                          | List MCP server registry.           |
| POST   | `/servers`                      | Admin JWT write | `McpServerInput`           | Register an MCP server.             |
| PATCH  | `/servers/:id`                  | Admin JWT write | `McpServerInput` (partial) | Update an MCP server.               |
| GET    | `/tenants/:tenant_id/access`    | Admin JWT       | —                          | List a tenant's MCP access policy.  |
| PUT    | `/tenants/:tenant_id/access`    | Admin JWT write | `TenantMcpAccessInput`     | Upsert a tenant's MCP grant.        |

## Memory — `/api/memory`

| Method | Path                  | Auth            | Body                | Description                       |
| ------ | --------------------- | --------------- | ------------------- | -------------------------------- |
| GET    | `/tenants/:tenant_id` | Admin JWT       | —                   | Get tenant memory config.        |
| PUT    | `/tenants/:tenant_id` | Admin JWT write | `MemoryConfigInput` | Set tenant memory config (ensures namespace). |

## LLM — `/api/llm`

| Method | Path                        | Auth            | Body             | Description                                |
| ------ | --------------------------- | --------------- | ---------------- | ----------------------------------------- |
| GET    | `/gateway`                  | Admin JWT       | —                | Gateway info (provider/base_url/configured). |
| GET    | `/tenants/:tenant_id`       | Admin JWT       | —                | Get tenant LLM config.                    |
| PUT    | `/tenants/:tenant_id`       | Admin JWT write | `LlmConfigInput` | Update tenant LLM config + virtual key.   |
| GET    | `/tenants/:tenant_id/spend` | Admin JWT       | —                | Live spend for the tenant's virtual key.  |

## Logs & metrics, audit, secrets — `/api`

These are registered under `/api` (module `logs`).

| Method | Path              | Auth            | Body                  | Description                                  |
| ------ | ----------------- | --------------- | --------------------- | ------------------------------------------- |
| GET    | `/events`         | Admin JWT       | query (tenant/severity/limit) | Tenant + agent runtime events.       |
| GET    | `/audit-logs`     | Admin JWT       | query (actor/target/limit) | Audit trail.                         |
| GET    | `/usage`          | Admin JWT       | query (tenant/limit)  | Token usage / spend metrics.                |
| GET    | `/secrets`        | Admin JWT       | query (tenant_id)     | List secret references (never plaintext).   |
| POST   | `/secrets`        | Admin JWT write | `CreateSecretRequest` | Create/update a secret (local = encrypted). |
| DELETE | `/secrets/:id`    | Admin JWT write | —                     | Delete a secret reference.                  |

## Backups — `/api/backups`

| Method | Path | Auth      | Body                 | Description                |
| ------ | ---- | --------- | -------------------- | ------------------------- |
| GET    | `/`  | Admin JWT | query (tenant/limit) | List backup jobs.         |

## Dashboard — `/api/dashboard`

| Method | Path       | Auth      | Body | Description                                          |
| ------ | ---------- | --------- | ---- | --------------------------------------------------- |
| GET    | `/summary` | Admin JWT | —    | Aggregates: tenants, hosts, commands, usage, errors. |

## Settings — `/api/settings`

| Method | Path    | Auth                          | Body          | Description                       |
| ------ | ------- | ----------------------------- | ------------- | -------------------------------- |
| GET    | `/`     | Admin JWT                     | —             | All platform settings (key/value). |
| PUT    | `/:key` | Admin JWT write (`msp_admin`+) | JSON object   | Upsert a platform setting.        |

---

## Request body types

All `*Request` / `*Input` body types referenced above are exported from
`@xoom/shared-types` (`packages/shared-types/src/admin.ts` for admin contracts,
`host-agent.ts` for the host-agent contract). Enums (`TenantStatus`,
`CommandType`, `UserRole`, `McpTransport`, `McpRiskLevel`, `SecretProvider`,
etc.) live in `enums.ts`.
