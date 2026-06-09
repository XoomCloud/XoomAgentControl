# XoomAgent Control Platform

A multi-tenant operations layer for running isolated AI agent tenants. The
control plane manages a fleet of **Hetzner dedicated Linux hosts**; each tenant
runs in its **own Firecracker MicroVM** (KVM-isolated) executing the
**SwarmClaw** agent runtime. Shared platform services — an **LLM gateway
(LiteLLM)**, **memory (Supermemory)** and an **MCP gateway** — are consumed by
tenants over outbound network paths.

This repo is a **pnpm monorepo** containing the control-plane API and web UI,
the per-host agent, shared packages, and the deployment infra.

In **production** the control plane is fully managed — the **web dashboard runs on
Vercel** and the **API + PostgreSQL run on Railway** — with **no servers to patch**.
Tenant workloads run on separate **Hetzner dedicated KVM hosts**, which connect
*outbound only* to the Railway API. See [Production deployment](#production-deployment).

---

## Architecture summary

```
   Operator browser
        │  loads dashboard (HTTPS)         │  data calls (HTTPS + JWT, CORS-allowed)
        ▼                                  ▼
 ┌──────────────────────┐        ┌──────────────────────────────┐
 │ Vercel               │        │ Railway                      │
 │ apps/web (Next.js)   │        │ apps/api (Fastify + Zod)     │
 │ operator dashboard   │        │   └── PostgreSQL (Prisma)    │
 └──────────────────────┘        └───────────────┬──────────────┘
   deploys from `main`                           │  ▲
                                                 │  │  outbound HTTPS only:
                          command queue ─────────┘  │  register · heartbeat (30s) ·
                          (HostCommand rows)         │  poll commands · results · logs
                                                 ▼  │
        ┌──────────────── Hetzner dedicated KVM host(s) ──────────────┐
        │  host-agent  (outbound-only — NO inbound management ports)  │
        │    ├── Firecracker MicroVM (tenant A) ── SwarmClaw runtime  │
        │    ├── Firecracker MicroVM (tenant B) ── SwarmClaw runtime  │
        │    └── …                                                    │
        └──────────────────────────────┬──────────────────────────────┘
                                        │ outbound
                                        ▼
   Shared services:  LiteLLM (LLM gateway) · Supermemory (memory) · MCP gateway
```

- The **control plane is fully managed**: **Vercel** serves the operator
  dashboard, **Railway** runs the API + PostgreSQL (all tenant/host/command/
  secret/event state). No servers to patch.
- The dashboard is a **browser client** — it loads from Vercel and calls the
  Railway API directly over HTTPS with a JWT; the API's `CORS_ORIGINS` allowlists
  the dashboard origin.
- **Host agents are outbound-only.** Hetzner hosts open **no inbound management
  ports**; the agent initiates every connection (register, heartbeat, poll for
  commands, report results, forward logs). Nothing ever connects *into* a host.
- Work is dispatched via a **command queue** (`HostCommand` rows): the API
  enqueues, the agent claims and executes on its Firecracker MicroVMs, and results
  reconcile tenant state.
- Each tenant is isolated in its **own Firecracker MicroVM** running the
  **SwarmClaw** runtime; tenants consume the shared LiteLLM / Supermemory / MCP
  services outbound.

---

## Monorepo structure

```
apps/
  web/            @xoom/web          Next.js operator console
  api/            @xoom/api          Fastify + Zod control-plane API
packages/
  db/             @xoom/db           Prisma schema, client, seed
  shared-types/   @xoom/shared-types Zod contracts (source of truth for API shapes)
  auth/           @xoom/auth         JWT sessions, password + agent-key hashing, RBAC helpers
  ui/                                Shared UI components
host-agent/       @xoom/host-agent   Per-host outbound agent (Firecracker + SwarmClaw)
infra/            docker-compose, Caddy reverse proxy, postgres/redis config
docs/             Architecture, host-agent, tenant-lifecycle, and API reference
```

---

## Tech stack

| Layer            | Choice                                                        |
| ---------------- | ------------------------------------------------------------ |
| Web              | Next.js (`apps/web`)                                          |
| API              | Fastify with `fastify-type-provider-zod`, OpenAPI via Swagger |
| Validation       | Zod schemas in `@xoom/shared-types`                          |
| Database         | PostgreSQL + Prisma (`@xoom/db`)                             |
| Cache / queue    | Redis (local infra only; not required by the MVP API)         |
| Auth             | JWT admin sessions; per-host bearer keys                      |
| Packaging / dev  | pnpm workspaces, Docker Compose                              |
| Host runtime     | KVM + Firecracker MicroVMs running SwarmClaw                 |
| Hosting — web    | **Vercel** (auto-deploys `apps/web` from `main`)             |
| Hosting — API+DB | **Railway** (Docker build of `apps/api` + managed PostgreSQL) |
| Tenant hosts     | **Hetzner** dedicated KVM (Firecracker + SwarmClaw)         |

> **Framework note:** the brief listed both **NestJS** and **Fastify** as
> acceptable for the API. **Fastify was chosen for the MVP** for its lighter
> footprint and first-class Zod type-provider integration (request/response
> validation plus auto-generated OpenAPI from the same schemas).

---

## Production deployment

The platform is deployed and **trunk-based on `main`**:

| Component     | Host                              | URL                                          |
| ------------- | --------------------------------- | -------------------------------------------- |
| Web dashboard | Vercel (`apps/web`)               | https://xoom-agent-control-api.vercel.app    |
| Control API   | Railway (`apps/api/Dockerfile`)   | https://xoom-api-production.up.railway.app   |
| Database      | Railway PostgreSQL                | internal to the Railway project              |

**Continuous deployment — both deploy from `main`:**

- **Web → Vercel.** Vercel's native GitHub integration auto-deploys `apps/web` to
  production on every push to `main` (project Root Directory = `apps/web`).
- **API → Railway.** [`.github/workflows/deploy-railway.yml`](.github/workflows/deploy-railway.yml)
  runs `railway up` on pushes to `main` that touch `apps/api`, `packages/`,
  `railway.toml`, or the lockfile, building `apps/api/Dockerfile`. Requires the
  repo secret `RAILWAY_TOKEN`.

**Wiring:**

- The web build receives `NEXT_PUBLIC_API_URL` (the Railway API URL) at build time.
- The API's `CORS_ORIGINS` allowlists the Vercel dashboard origin(s).
- The API container runs `prisma db push` + seed on boot, then starts. (Use
  `prisma migrate deploy` with checked-in migrations for change-controlled releases.)
- The Vercel project has **Deployment Protection (SSO)** enabled, so the dashboard
  sits behind Vercel auth *in addition to* the app's own operator login.

**Provider-agnostic by design.** Railway can be swapped for any container host
(Render / Fly / a VPS) and Railway Postgres for Neon or any managed Postgres by
changing `DATABASE_URL`; the host agent and tenant model are unaffected.

---

## Quickstart (local development)

### 1. Install

```bash
pnpm install
```

### 2. Start PostgreSQL (and Redis)

Either run Postgres directly:

```bash
docker run --name xoom-pg -e POSTGRES_USER=xoom -e POSTGRES_PASSWORD=xoom \
  -e POSTGRES_DB=xoomagent -p 5432:5432 -d postgres:16-alpine
```

…or bring up the full infra stack (Postgres, Redis, API, web, Caddy):

```bash
docker compose -f infra/docker-compose.yml up -d postgres redis
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env — at minimum set JWT_SECRET (32+ chars). For real secret
# encryption generate a key:  openssl rand -base64 32  -> SECRETS_MASTER_KEY
```

### 4. Apply schema and seed

```bash
pnpm db:push    # push the Prisma schema to the database
pnpm db:seed    # create the bootstrap admin + MCP registry + starter template
```

The seed creates:

- a **platform owner** admin — `admin@xoomagent.local` / `changeme123!`
  (override via `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`)
- the **MCP registry** (filesystem, microsoft-365, google-workspace, slack,
  xero, myob, salesforce, sql-database, custom-http-api)
- a starter **agent template** ("General Assistant")
- default **platform settings**

### 5. Run the control plane

```bash
pnpm dev:api    # API on http://localhost:4000
pnpm dev:web    # web console on http://localhost:3000
```

Interactive API docs (Swagger UI) are served at **http://localhost:4000/docs**.

### 6. Run a host agent (mock mode)

The agent defaults to **mock mode**, so it simulates Firecracker/SwarmClaw and
runs on any machine — no KVM required.

```bash
export CONTROL_PLANE_URL=http://localhost:4000
export HOST_REGISTRATION_TOKEN=dev-host-registration-token   # must match the API's value
export HOST_NAME=dev-host-01
export AGENT_MOCK_MODE=true
pnpm dev:agent
```

The agent registers, then heartbeats every 30s. **A new host stays unapproved
until an operator approves it** (`POST /api/hosts/:id/approve`); heartbeats and
command polling only succeed after approval. See
[`docs/host-agent.md`](docs/host-agent.md).

---

## Verified end-to-end

The MVP has been exercised against the following acceptance criteria — all
passing:

- [x] Operator can log in with the seeded admin account (JWT session).
- [x] A host agent can register using the bootstrap token and receive a
      long-lived per-host key.
- [x] An operator can approve a registered host.
- [x] An approved host heartbeats and its online/offline status is derived from
      heartbeat freshness.
- [x] An operator can create a tenant; the scheduler selects a host with
      capacity and reserves resources.
- [x] Tenant creation provisions an LLM virtual key (secret ref), a memory
      namespace, and persists runtime config.
- [x] A `create_tenant` command is queued and claimed by the host agent.
- [x] The agent provisions a MicroVM + SwarmClaw (mock) and reports a result.
- [x] The control plane reconciles the tenant to `active` (or `failed`).
- [x] Lifecycle actions (start/stop/restart/backup/update_runtime/suspend/delete)
      enqueue the correct command and transition tenant status.
- [x] Capacity is released back to the host on tenant delete.
- [x] Every mutating admin action writes an audit log entry; tenant/host events
      are recorded and visible.

---

## MVP scope vs non-goals

**In scope (MVP):**

- Control-plane API + operator console.
- Outbound host-agent contract: register, heartbeat, command poll/result, log
  forwarding.
- Tenant lifecycle orchestration via the command queue.
- Host scheduling + capacity reservation.
- Provider abstractions with concrete impls: LiteLLM (LLM), Supermemory
  (memory), local AES-256-GCM secrets.
- Mock Firecracker/SwarmClaw provisioning plus a real-provisioning code path
  gated behind `AGENT_MOCK_MODE=false`.
- RBAC, audit logging, events/usage metrics in PostgreSQL.

**Non-goals (for now):**

- Production-grade real Firecracker/SwarmClaw automation (guest bootstrap over
  vsock, image pipelines) — the real path is sketched but mock by default.
- External secrets backends (Vault/Infisical/Doppler/AWS) — interface exists,
  only `local` is implemented.
- Dedicated log/metrics stores (Loki/ClickHouse) — events live in Postgres for
  now (see `docs/architecture.md`).
- Tenant-scoped self-service portal beyond the operator console.

---

## Security notes

- **RBAC roles** (`UserRole`): `platform_owner`, `msp_admin`,
  `support_engineer`, `read_only_auditor`, `tenant_admin`. Writes are blocked for
  `read_only_auditor`; destructive actions (tenant delete/suspend, host approve)
  and user management require `msp_admin`+.
- **Host credentials:** a brand-new host authenticates `POST /api/hosts/register`
  with the shared `HOST_REGISTRATION_TOKEN` (`X-Registration-Token` header). It
  then receives a **long-lived per-host key** used as a `Bearer` token on all
  later calls. Only its **bcrypt hash** is stored, and the raw key is returned
  exactly once.
- **Approval gate:** registered hosts are `approved = false` by default;
  heartbeat/command endpoints reject unapproved hosts.
- **Secret envelope encryption:** local secrets are encrypted at rest with
  **AES-256-GCM** under `SECRETS_MASTER_KEY` (format `v1:<iv>:<tag>:<ciphertext>`).
  Secret APIs never return plaintext.
- **Audit logging:** every mutating admin action emits a canonical audit action
  (see `AUDIT_ACTIONS`) into `audit_logs`, with actor and IP.

See [`docs/architecture.md`](docs/architecture.md) for the full design,
[`docs/host-agent.md`](docs/host-agent.md) for the agent contract,
[`docs/tenant-lifecycle.md`](docs/tenant-lifecycle.md) for the provisioning
flow, and [`docs/api.md`](docs/api.md) for the REST reference.
