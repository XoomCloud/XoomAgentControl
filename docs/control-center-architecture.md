# XoomAgent Control Center — Architecture

The Control Center turns the deployment console into a full **AI Operations
Centre** by adding two planes on top of the existing control plane:

| Plane | Purpose | Storage | Status |
| --- | --- | --- | --- |
| **Control** (existing) | Deploy/manage tenants, hosts, templates, RBAC, secrets | PostgreSQL | shipped |
| **Observability** (new) | Ingest + query metrics, logs, traces, usage | ClickHouse (prod) / in-memory (dev) | Phases 0–2 |
| **Realtime** (new) | Push live updates to the UI | Socket.IO (+ Redis adapter for scale) | shipped |
| **Automation** (future) | Recommend + self-heal | — | Phase 8 |

## System diagram

```
                       ┌──────────── Control Center (Next.js / Vercel) ────────────┐
 Engineers ──────────► │ command palette · entity shell · dockable widgets         │
                       └──── REST (state) ──── WS (live) ──── query (telemetry) ────┘
                                  │              │                  │
        ┌─────────────────────────┴───┐  ┌───────┴────────┐  ┌──────┴───────────────┐
        │ Control API (Railway)        │  │ Realtime (S.IO) │  │ Telemetry query API  │
        │ Postgres                     │  │ topic fan-out   │  │ → TelemetryStore     │
        └───────────────┬──────────────┘  └───────▲────────┘  └──────▲───────────────┘
            enqueue cmds │                          │ publish        │
                         ▼     ┌── Ingestion (/api/hosts/:id/telemetry, host-authed) ──┐
                               │  TelemetryStore.write()  +  rt.publish(topic, …)      │
                               └──────────────▲───────────────────────────────────────┘
                                   outbound only │
                  host-agent (hosts) ────────────┘  metrics · logs (log-folder shipper) ·
                                                     agent state (runtime poller)
```

## Folder structure (added)

```
packages/telemetry/            TelemetryStore: ClickHouse + in-memory impls, DDL
packages/shared-types/src/
  telemetry.ts                 Metric/Log/Span/Conversation/Usage + ingest/query/RT topics
  control-center.ts            agent registry / provider / integration contracts
apps/api/src/
  plugins/realtime.ts          Socket.IO gateway (JWT topics)
  modules/ingest/              host-authed telemetry + agent-heartbeat ingestion
  modules/telemetry/           admin query API (metrics/logs/usage/latest)
  modules/agents/              deployed-agent registry + lifecycle actions
  modules/providers/           LLM provider registry + 24h cost rollup
  modules/integrations/        connector registry + catalog (plugin-driven)
host-agent/src/collectors/
  log-shipper.ts               tails configured log folders → structured logs
  runtime-poller.ts            polls SwarmClaw/OpenClaw APIs → agent heartbeats
apps/web/src/
  lib/{query,realtime,charts}  TanStack Query + Socket.IO + Recharts primitives
  components/{CommandPalette,NotificationCenter,EntityShell}
  app/(dashboard)/{agents,infrastructure,providers,integrations}/
```

## Data model

- **Postgres** (config/state): existing tables + `agents`, `providers`, `integrations`.
- **ClickHouse** (telemetry, time-series): `metrics`, `logs`, `spans`,
  `conversation_events`, `usage_events` (DDL in `packages/telemetry/src/schema.sql`).
  When `CLICKHOUSE_URL` is unset, an in-memory ring-buffer store is used so the
  whole stack runs in dev with no external infra — identical interface.

## Telemetry contract

Everything emitted is one of: `MetricPoint`, `LogRecord`, `Span`,
`ConversationEvent`, `UsageEvent` (OpenTelemetry-aligned, see
`shared-types/src/telemetry.ts`). Emission paths:

- **host-agent** → host metrics (CPU/RAM/disk/uptime/microvms/docker), log lines
  from `XOOM_LOG_DIRS`, and agent state from `XOOM_RUNTIMES` runtime pollers.
- **LLM gateway / MCP** (future wiring) → usage/latency/cost via callbacks.
- **tenant runtime** (future) → conversation events + OTel spans.

Ingestion is **outbound-only and host-authed**: `POST /api/hosts/:id/telemetry`
and `POST /api/hosts/:id/agents` use the host's long-lived key. The control
plane never connects into a host.

## API (added)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/hosts/:id/telemetry` | host key | ingest metrics/logs/spans/usage/convos |
| POST | `/api/hosts/:id/agents` | host key | agent heartbeats → registry + metrics |
| GET | `/api/telemetry/{backend,metrics,logs,usage,latest}` | admin | query telemetry |
| GET/POST | `/api/agents`, `/api/agents/:id`, `/api/agents/:id/actions` | admin | agent registry + lifecycle |
| GET/POST | `/api/providers` | admin | provider registry + 24h cost |
| GET/POST/PATCH/DELETE | `/api/integrations`, `/api/integrations/catalog` | admin | connectors |
| WS | `/socket.io` | JWT | realtime topic subscriptions |

Realtime topics: `overview`, `host:<id>:metrics`, `host:<id>:logs`,
`agent:<id>`, `agent:<id>:metrics`, `alerts`.

## Integration / plugin model

`modules/integrations/catalog.ts` declares connector kinds (SwarmClaw, OpenClaw,
Grafana, Prometheus, Loki, Uptime Kuma, Hetzner, Cloudflare, Tailscale, Discord,
M365/Teams, GitHub, HaloPSA, Hudu, QuickBooks…) with a typed field schema. The
Integrations UI renders config forms straight from the catalog, so **new
connectors need no UI changes**. Secrets fields are stored as `secrets_references`.

## Phases

- **Phase 0 (backbone) — done:** telemetry store + DDL, Socket.IO realtime,
  ingestion + query APIs, UI shell (palette, entity shell, notifications, live status).
- **Phase 1 (infra) — done:** host-agent metric/log/docker collectors;
  Infrastructure module with live per-host dashboards.
- **Phase 2 (agents) — done:** runtime poller → agent registry; Agents module
  with live health/response charts, logs, lifecycle actions; conversation/usage
  schemas in place.
- **Next:** Phase 3 provider/MCP deep monitoring + cost analytics, Phase 4
  distributed tracing UI, Phase 5 alert rules + notification channels + incidents,
  Phase 6 per-client deep-dive, Phase 7 connector marketplace fan-out, Phase 8
  autonomous recommendations.

## Running with ClickHouse (production telemetry)

Set on the API service (Railway):

```
CLICKHOUSE_URL=https://<host>:8443
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=…
CLICKHOUSE_DB=default
```

On boot the API calls `TelemetryStore.ensureSchema()` (creates the tables). With
no `CLICKHOUSE_URL`, it runs on the in-memory store (dev). For horizontal scale,
add the `@socket.io/redis-adapter` (publisher API is unchanged) and front
ingestion with Redis Streams.

## Host-agent telemetry config

```
TELEMETRY_INTERVAL_SECONDS=15
XOOM_LOG_DIRS=/var/lib/swarmclaw/logs,/var/log/openclaw
XOOM_RUNTIMES=[{"tenant_id":"<id>","type":"swarmclaw","base_url":"http://127.0.0.1:8080","api_key":"…"}]
```

## Known gaps (honest)

- Conversation events + spans are accepted and stored, but the SwarmClaw/OpenClaw
  span instrumentation (full distributed traces) is not yet wired — Phase 4.
- Provider latency/cost depends on LiteLLM callbacks being forwarded to ingestion
  (planned in Phase 3); the registry + 24h rollup from `usage_events` works today.
- UI uses the existing CSS design system (dark/glass) rather than shadcn/ui; a
  shadcn + Tailwind migration is a non-blocking follow-up.
