import { z } from "zod";

// ──────────────────────────────────────────────────────────────────────────
// Telemetry contracts (Control Center observability plane)
//
// OpenTelemetry-aligned but intentionally small. Everything an agent/host/
// gateway emits is one of: Metric, LogRecord, Span, ConversationEvent,
// UsageEvent. The control plane ingests these into a time-series store
// (ClickHouse in prod; in-memory ring buffers in dev) and fans them out over
// websockets to the Control Center UI.
// ──────────────────────────────────────────────────────────────────────────

/** Source that emitted the telemetry. */
export const TelemetrySource = z.object({
  kind: z.enum(["host", "agent", "tenant", "gateway", "mcp", "provider", "control"]),
  host_id: z.string().optional(),
  tenant_id: z.string().optional(),
  agent_id: z.string().optional(),
  service: z.string().optional(),
});
export type TelemetrySource = z.infer<typeof TelemetrySource>;

export const MetricPoint = z.object({
  name: z.string(), // e.g. "host.cpu.usage", "agent.response_time_ms"
  value: z.number(),
  unit: z.string().optional(), // "percent" | "ms" | "bytes" | "count" | ...
  ts: z.number().int(), // epoch ms
  attributes: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type MetricPoint = z.infer<typeof MetricPoint>;

export const LogSeverity = z.enum(["trace", "debug", "info", "warn", "error", "fatal"]);
export type LogSeverity = z.infer<typeof LogSeverity>;

export const LogRecord = z.object({
  ts: z.number().int(),
  severity: LogSeverity.default("info"),
  message: z.string(),
  // free-form structured fields + correlation ids
  attributes: z.record(z.unknown()).optional(),
  trace_id: z.string().optional(),
  span_id: z.string().optional(),
  // where the line came from (log folder shipper / runtime poller / stdout)
  collector: z.string().optional(),
});
export type LogRecord = z.infer<typeof LogRecord>;

export const Span = z.object({
  trace_id: z.string(),
  span_id: z.string(),
  parent_span_id: z.string().optional(),
  name: z.string(),
  // request → gateway → orchestrator → agent → mcp → provider → memory → db → response
  kind: z.enum(["request", "gateway", "orchestrator", "agent", "mcp", "provider", "memory", "db", "internal"]).default("internal"),
  start_ts: z.number().int(),
  end_ts: z.number().int(),
  status: z.enum(["ok", "error"]).default("ok"),
  attributes: z.record(z.unknown()).optional(),
});
export type Span = z.infer<typeof Span>;

export const ConversationEvent = z.object({
  ts: z.number().int(),
  conversation_id: z.string(),
  agent_id: z.string().optional(),
  event: z.enum(["started", "message", "tool_call", "completed", "error"]),
  role: z.enum(["user", "assistant", "tool", "system"]).optional(),
  tokens_in: z.number().int().optional(),
  tokens_out: z.number().int().optional(),
  model: z.string().optional(),
  duration_ms: z.number().optional(),
  attributes: z.record(z.unknown()).optional(),
});
export type ConversationEvent = z.infer<typeof ConversationEvent>;

export const UsageEvent = z.object({
  ts: z.number().int(),
  provider: z.string(), // openai | anthropic | openrouter | ...
  model: z.string(),
  agent_id: z.string().optional(),
  tokens_in: z.number().int().default(0),
  tokens_out: z.number().int().default(0),
  cost_usd: z.number().default(0),
  latency_ms: z.number().optional(),
  status: z.enum(["ok", "error", "rate_limited", "fallback"]).default("ok"),
});
export type UsageEvent = z.infer<typeof UsageEvent>;

// ── Ingestion (agents/hosts/gateway → control plane, host-key authed) ──
export const IngestBatch = z.object({
  source: TelemetrySource,
  metrics: z.array(MetricPoint).optional(),
  logs: z.array(LogRecord).optional(),
  spans: z.array(Span).optional(),
  conversations: z.array(ConversationEvent).optional(),
  usage: z.array(UsageEvent).optional(),
});
export type IngestBatch = z.infer<typeof IngestBatch>;

// ── Query (Control Center UI → telemetry query API, admin authed) ──
export const MetricQuery = z.object({
  name: z.string(),
  host_id: z.string().optional(),
  tenant_id: z.string().optional(),
  agent_id: z.string().optional(),
  since: z.string().optional(), // ISO or relative like "1h","30m"
  until: z.string().optional(),
  step_seconds: z.coerce.number().int().positive().default(60),
  agg: z.enum(["avg", "sum", "max", "min", "last"]).default("avg"),
});
export type MetricQuery = z.infer<typeof MetricQuery>;

export const LogQuery = z.object({
  q: z.string().optional(),
  host_id: z.string().optional(),
  tenant_id: z.string().optional(),
  agent_id: z.string().optional(),
  severity: LogSeverity.optional(),
  trace_id: z.string().optional(),
  since: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});
export type LogQuery = z.infer<typeof LogQuery>;

// ── Realtime topics (websocket subscriptions) ──
export const RT_TOPICS = {
  overview: "overview",
  hostMetrics: (hostId: string) => `host:${hostId}:metrics`,
  hostLogs: (hostId: string) => `host:${hostId}:logs`,
  agent: (agentId: string) => `agent:${agentId}`,
  agentMetrics: (agentId: string) => `agent:${agentId}:metrics`,
  tenantEvents: (tenantId: string) => `tenant:${tenantId}:events`,
  alerts: "alerts",
} as const;

// Known metric names (kept central so emitters + dashboards agree).
export const METRICS = {
  HOST_CPU: "host.cpu.usage",
  HOST_RAM: "host.ram.usage",
  HOST_DISK: "host.disk.usage",
  HOST_NET_RX: "host.net.rx_bytes",
  HOST_NET_TX: "host.net.tx_bytes",
  HOST_UPTIME: "host.uptime_seconds",
  HOST_MICROVMS: "host.microvms.running",
  AGENT_HEALTH: "agent.health_score",
  AGENT_RESPONSE_MS: "agent.response_time_ms",
  AGENT_QUEUE: "agent.queue_length",
  AGENT_TOOLCALLS: "agent.tool_calls",
  AGENT_MEM: "agent.memory_bytes",
  PROVIDER_LATENCY: "provider.latency_ms",
  PROVIDER_ERRORS: "provider.error_rate",
} as const;
