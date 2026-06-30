import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { IngestBatch, MetricQuery, LogQuery } from "@xoom/shared-types";
import type { TelemetryStore, MetricSeries, LogRow, UsageSummary } from "./index.js";
import { parseSince } from "./time.js";

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS metrics (ts DateTime64(3), name LowCardinality(String), value Float64, unit LowCardinality(String) DEFAULT '', host_id String DEFAULT '', tenant_id String DEFAULT '', agent_id String DEFAULT '', source_kind LowCardinality(String) DEFAULT '', attributes String DEFAULT '{}') ENGINE = MergeTree ORDER BY (name, host_id, tenant_id, agent_id, ts) TTL toDateTime(ts) + INTERVAL 90 DAY`,
  `CREATE TABLE IF NOT EXISTS logs (ts DateTime64(3), severity LowCardinality(String), message String, host_id String DEFAULT '', tenant_id String DEFAULT '', agent_id String DEFAULT '', source_kind LowCardinality(String) DEFAULT '', collector LowCardinality(String) DEFAULT '', trace_id String DEFAULT '', span_id String DEFAULT '', attributes String DEFAULT '{}') ENGINE = MergeTree ORDER BY (ts) TTL toDateTime(ts) + INTERVAL 30 DAY`,
  `CREATE TABLE IF NOT EXISTS spans (start_ts DateTime64(3), end_ts DateTime64(3), duration_ms Float64, trace_id String, span_id String, parent_span_id String DEFAULT '', name String, kind LowCardinality(String), status LowCardinality(String), tenant_id String DEFAULT '', agent_id String DEFAULT '', attributes String DEFAULT '{}') ENGINE = MergeTree ORDER BY (trace_id, start_ts) TTL toDateTime(start_ts) + INTERVAL 14 DAY`,
  `CREATE TABLE IF NOT EXISTS conversation_events (ts DateTime64(3), conversation_id String, agent_id String DEFAULT '', tenant_id String DEFAULT '', event LowCardinality(String), role LowCardinality(String) DEFAULT '', model LowCardinality(String) DEFAULT '', tokens_in UInt32 DEFAULT 0, tokens_out UInt32 DEFAULT 0, duration_ms Float64 DEFAULT 0, attributes String DEFAULT '{}') ENGINE = MergeTree ORDER BY (tenant_id, ts) TTL toDateTime(ts) + INTERVAL 90 DAY`,
  `CREATE TABLE IF NOT EXISTS usage_events (ts DateTime64(3), provider LowCardinality(String), model LowCardinality(String), tenant_id String DEFAULT '', agent_id String DEFAULT '', tokens_in UInt32 DEFAULT 0, tokens_out UInt32 DEFAULT 0, cost_usd Float64 DEFAULT 0, latency_ms Float64 DEFAULT 0, status LowCardinality(String) DEFAULT 'ok') ENGINE = MergeTree ORDER BY (tenant_id, provider, ts)`,
];

const dt = (ms: number) => new Date(ms).toISOString().replace("T", " ").replace("Z", "");

/** ClickHouse-backed telemetry store for production scale. */
export class ClickHouseStore implements TelemetryStore {
  readonly backend = "clickhouse" as const;
  private client: ClickHouseClient;

  constructor(opts: { url: string; username: string; password: string; database: string }) {
    this.client = createClient({
      url: opts.url,
      username: opts.username,
      password: opts.password,
      database: opts.database,
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
    });
  }

  async ensureSchema(): Promise<void> {
    for (const ddl of DDL) await this.client.command({ query: ddl });
  }

  async write(batch: IngestBatch): Promise<void> {
    const s = batch.source;
    const attrs = (a: unknown) => JSON.stringify(a ?? {});
    const tasks: Promise<unknown>[] = [];

    if (batch.metrics?.length) {
      tasks.push(this.client.insert({
        table: "metrics",
        format: "JSONEachRow",
        values: batch.metrics.map((m) => ({
          ts: dt(m.ts), name: m.name, value: m.value, unit: m.unit ?? "",
          host_id: s.host_id ?? "", tenant_id: s.tenant_id ?? "", agent_id: s.agent_id ?? "",
          source_kind: s.kind, attributes: attrs(m.attributes),
        })),
      }));
    }
    if (batch.logs?.length) {
      tasks.push(this.client.insert({
        table: "logs",
        format: "JSONEachRow",
        values: batch.logs.map((l) => ({
          ts: dt(l.ts), severity: l.severity, message: l.message,
          host_id: s.host_id ?? "", tenant_id: s.tenant_id ?? "", agent_id: s.agent_id ?? "",
          source_kind: s.kind, collector: l.collector ?? "", trace_id: l.trace_id ?? "",
          span_id: l.span_id ?? "", attributes: attrs(l.attributes),
        })),
      }));
    }
    if (batch.spans?.length) {
      tasks.push(this.client.insert({
        table: "spans",
        format: "JSONEachRow",
        values: batch.spans.map((sp) => ({
          start_ts: dt(sp.start_ts), end_ts: dt(sp.end_ts), duration_ms: sp.end_ts - sp.start_ts,
          trace_id: sp.trace_id, span_id: sp.span_id, parent_span_id: sp.parent_span_id ?? "",
          name: sp.name, kind: sp.kind, status: sp.status,
          tenant_id: s.tenant_id ?? "", agent_id: s.agent_id ?? "", attributes: attrs(sp.attributes),
        })),
      }));
    }
    if (batch.conversations?.length) {
      tasks.push(this.client.insert({
        table: "conversation_events",
        format: "JSONEachRow",
        values: batch.conversations.map((c) => ({
          ts: dt(c.ts), conversation_id: c.conversation_id, agent_id: c.agent_id ?? s.agent_id ?? "",
          tenant_id: s.tenant_id ?? "", event: c.event, role: c.role ?? "", model: c.model ?? "",
          tokens_in: c.tokens_in ?? 0, tokens_out: c.tokens_out ?? 0, duration_ms: c.duration_ms ?? 0,
          attributes: attrs(c.attributes),
        })),
      }));
    }
    if (batch.usage?.length) {
      tasks.push(this.client.insert({
        table: "usage_events",
        format: "JSONEachRow",
        values: batch.usage.map((u) => ({
          ts: dt(u.ts), provider: u.provider, model: u.model, tenant_id: s.tenant_id ?? "",
          agent_id: u.agent_id ?? s.agent_id ?? "", tokens_in: u.tokens_in, tokens_out: u.tokens_out,
          cost_usd: u.cost_usd, latency_ms: u.latency_ms ?? 0, status: u.status,
        })),
      }));
    }
    await Promise.all(tasks);
  }

  private filters(q: { host_id?: string; tenant_id?: string; agent_id?: string }): string {
    const parts: string[] = [];
    if (q.host_id) parts.push(`host_id = {host_id:String}`);
    if (q.tenant_id) parts.push(`tenant_id = {tenant_id:String}`);
    if (q.agent_id) parts.push(`agent_id = {agent_id:String}`);
    return parts.length ? " AND " + parts.join(" AND ") : "";
  }

  async queryMetrics(q: MetricQuery): Promise<MetricSeries> {
    const since = parseSince(q.since);
    const until = q.until ? parseSince(q.until) : Date.now();
    const aggFn = { avg: "avg", sum: "sum", max: "max", min: "min", last: "anyLast" }[q.agg];
    const sql = `SELECT toUnixTimestamp(toStartOfInterval(ts, INTERVAL {step:UInt32} SECOND)) * 1000 AS bucket, ${aggFn}(value) AS v
      FROM metrics WHERE name = {name:String} AND ts >= {since:DateTime64(3)} AND ts <= {until:DateTime64(3)}${this.filters(q)}
      GROUP BY bucket ORDER BY bucket`;
    const rs = await this.client.query({
      query: sql,
      format: "JSONEachRow",
      query_params: { step: q.step_seconds, name: q.name, since: dt(since), until: dt(until), host_id: q.host_id, tenant_id: q.tenant_id, agent_id: q.agent_id },
    });
    const rows = (await rs.json()) as { bucket: number; v: number }[];
    return { name: q.name, points: rows.map((r) => ({ ts: Number(r.bucket), value: Number(r.v) })) };
  }

  async queryLogs(q: LogQuery): Promise<LogRow[]> {
    const since = parseSince(q.since, 24 * 3600_000);
    let sql = `SELECT toUnixTimestamp64Milli(ts) AS ts, severity, message, host_id, tenant_id, agent_id, collector, trace_id, attributes
      FROM logs WHERE ts >= {since:DateTime64(3)}${this.filters(q)}`;
    if (q.severity) sql += ` AND severity = {severity:String}`;
    if (q.trace_id) sql += ` AND trace_id = {trace_id:String}`;
    if (q.q) sql += ` AND positionCaseInsensitive(message, {q:String}) > 0`;
    sql += ` ORDER BY ts DESC LIMIT {limit:UInt32}`;
    const rs = await this.client.query({
      query: sql,
      format: "JSONEachRow",
      query_params: { since: dt(since), host_id: q.host_id, tenant_id: q.tenant_id, agent_id: q.agent_id, severity: q.severity, trace_id: q.trace_id, q: q.q, limit: q.limit },
    });
    const rows = (await rs.json()) as Record<string, unknown>[];
    return rows.map((r) => ({
      ts: Number(r.ts), severity: String(r.severity), message: String(r.message),
      host_id: String(r.host_id ?? ""), tenant_id: String(r.tenant_id ?? ""), agent_id: String(r.agent_id ?? ""),
      collector: String(r.collector ?? ""), trace_id: String(r.trace_id ?? ""),
      attributes: safeParse(r.attributes),
    }));
  }

  async usageSummary(opts: { since?: string; tenant_id?: string }): Promise<UsageSummary> {
    const since = parseSince(opts.since, 24 * 3600_000);
    const where = `ts >= {since:DateTime64(3)}${opts.tenant_id ? " AND tenant_id = {tenant_id:String}" : ""}`;
    const params = { since: dt(since), tenant_id: opts.tenant_id };
    const totalRs = await this.client.query({ query: `SELECT sum(tokens_in) ti, sum(tokens_out) to, sum(cost_usd) c FROM usage_events WHERE ${where}`, format: "JSONEachRow", query_params: params });
    const [t] = (await totalRs.json()) as { ti: number; to: number; c: number }[];
    const provRs = await this.client.query({ query: `SELECT provider, sum(cost_usd) cost_usd, sum(tokens_in+tokens_out) tokens FROM usage_events WHERE ${where} GROUP BY provider ORDER BY cost_usd DESC`, format: "JSONEachRow", query_params: params });
    const modelRs = await this.client.query({ query: `SELECT model, sum(cost_usd) cost_usd, sum(tokens_in+tokens_out) tokens FROM usage_events WHERE ${where} GROUP BY model ORDER BY cost_usd DESC LIMIT 20`, format: "JSONEachRow", query_params: params });
    return {
      tokens_in: Number(t?.ti ?? 0), tokens_out: Number(t?.to ?? 0), cost_usd: Number(t?.c ?? 0),
      by_provider: ((await provRs.json()) as Record<string, unknown>[]).map((r) => ({ provider: String(r.provider), cost_usd: Number(r.cost_usd), tokens: Number(r.tokens) })),
      by_model: ((await modelRs.json()) as Record<string, unknown>[]).map((r) => ({ model: String(r.model), cost_usd: Number(r.cost_usd), tokens: Number(r.tokens) })),
    };
  }

  async latest(name: string, filter?: { host_id?: string; agent_id?: string; tenant_id?: string }): Promise<number | null> {
    const sql = `SELECT value FROM metrics WHERE name = {name:String}${this.filters(filter ?? {})} ORDER BY ts DESC LIMIT 1`;
    const rs = await this.client.query({ query: sql, format: "JSONEachRow", query_params: { name, ...filter } });
    const rows = (await rs.json()) as { value: number }[];
    return rows.length ? Number(rows[0]!.value) : null;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

function safeParse(v: unknown): Record<string, unknown> | undefined {
  if (typeof v !== "string" || !v) return undefined;
  try {
    return JSON.parse(v) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
