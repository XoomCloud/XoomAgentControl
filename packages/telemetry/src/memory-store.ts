import type { IngestBatch, MetricQuery, LogQuery } from "@xoom/shared-types";
import type { TelemetryStore, MetricSeries, LogRow, UsageSummary } from "./index.js";
import { parseSince } from "./time.js";

interface MetricRow {
  ts: number;
  name: string;
  value: number;
  host_id: string;
  tenant_id: string;
  agent_id: string;
}
interface UsageRow {
  ts: number;
  provider: string;
  model: string;
  tenant_id: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
}

/**
 * In-memory ring-buffer telemetry store for dev / when ClickHouse isn't
 * configured. Bounded so it never leaks memory. Not durable — restart clears it.
 */
export class MemoryStore implements TelemetryStore {
  readonly backend = "memory" as const;
  private metrics: MetricRow[] = [];
  private logs: LogRow[] = [];
  private usage: UsageRow[] = [];
  private readonly MAX_METRICS = 200_000;
  private readonly MAX_LOGS = 20_000;
  private readonly MAX_USAGE = 100_000;

  async ensureSchema() {
    /* nothing to do for memory store */
  }

  async write(batch: IngestBatch): Promise<void> {
    const s = batch.source;
    for (const m of batch.metrics ?? []) {
      this.metrics.push({
        ts: m.ts,
        name: m.name,
        value: m.value,
        host_id: s.host_id ?? "",
        tenant_id: s.tenant_id ?? "",
        agent_id: s.agent_id ?? "",
      });
    }
    for (const l of batch.logs ?? []) {
      this.logs.push({
        ts: l.ts,
        severity: l.severity,
        message: l.message,
        host_id: s.host_id,
        tenant_id: s.tenant_id,
        agent_id: s.agent_id,
        collector: l.collector,
        trace_id: l.trace_id,
        attributes: l.attributes,
      });
    }
    for (const u of batch.usage ?? []) {
      this.usage.push({
        ts: u.ts,
        provider: u.provider,
        model: u.model,
        tenant_id: s.tenant_id ?? "",
        tokens_in: u.tokens_in,
        tokens_out: u.tokens_out,
        cost_usd: u.cost_usd,
      });
    }
    // conversations + spans are accepted but not indexed in the memory store.
    if (this.metrics.length > this.MAX_METRICS) this.metrics.splice(0, this.metrics.length - this.MAX_METRICS);
    if (this.logs.length > this.MAX_LOGS) this.logs.splice(0, this.logs.length - this.MAX_LOGS);
    if (this.usage.length > this.MAX_USAGE) this.usage.splice(0, this.usage.length - this.MAX_USAGE);
  }

  async queryMetrics(q: MetricQuery): Promise<MetricSeries> {
    const since = parseSince(q.since);
    const until = q.until ? parseSince(q.until) : Date.now();
    const rows = this.metrics.filter(
      (r) =>
        r.name === q.name &&
        r.ts >= since &&
        r.ts <= until &&
        (!q.host_id || r.host_id === q.host_id) &&
        (!q.tenant_id || r.tenant_id === q.tenant_id) &&
        (!q.agent_id || r.agent_id === q.agent_id),
    );
    // bucket into step_seconds windows and aggregate
    const stepMs = q.step_seconds * 1000;
    const buckets = new Map<number, number[]>();
    for (const r of rows) {
      const b = Math.floor(r.ts / stepMs) * stepMs;
      (buckets.get(b) ?? buckets.set(b, []).get(b)!).push(r.value);
    }
    const points = [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ts, vals]) => ({ ts, value: aggregate(vals, q.agg) }));
    return { name: q.name, points };
  }

  async queryLogs(q: LogQuery): Promise<LogRow[]> {
    const since = parseSince(q.since, 24 * 3600_000);
    return this.logs
      .filter(
        (l) =>
          l.ts >= since &&
          (!q.host_id || l.host_id === q.host_id) &&
          (!q.tenant_id || l.tenant_id === q.tenant_id) &&
          (!q.agent_id || l.agent_id === q.agent_id) &&
          (!q.severity || l.severity === q.severity) &&
          (!q.trace_id || l.trace_id === q.trace_id) &&
          (!q.q || l.message.toLowerCase().includes(q.q.toLowerCase())),
      )
      .sort((a, b) => b.ts - a.ts)
      .slice(0, q.limit);
  }

  async usageSummary(opts: { since?: string; tenant_id?: string }): Promise<UsageSummary> {
    const since = parseSince(opts.since, 24 * 3600_000);
    const rows = this.usage.filter((u) => u.ts >= since && (!opts.tenant_id || u.tenant_id === opts.tenant_id));
    const byProvider = new Map<string, { cost_usd: number; tokens: number }>();
    const byModel = new Map<string, { cost_usd: number; tokens: number }>();
    let tin = 0,
      tout = 0,
      cost = 0;
    for (const u of rows) {
      tin += u.tokens_in;
      tout += u.tokens_out;
      cost += u.cost_usd;
      const p = byProvider.get(u.provider) ?? { cost_usd: 0, tokens: 0 };
      p.cost_usd += u.cost_usd;
      p.tokens += u.tokens_in + u.tokens_out;
      byProvider.set(u.provider, p);
      const m = byModel.get(u.model) ?? { cost_usd: 0, tokens: 0 };
      m.cost_usd += u.cost_usd;
      m.tokens += u.tokens_in + u.tokens_out;
      byModel.set(u.model, m);
    }
    return {
      tokens_in: tin,
      tokens_out: tout,
      cost_usd: cost,
      by_provider: [...byProvider.entries()].map(([provider, v]) => ({ provider, ...v })),
      by_model: [...byModel.entries()].map(([model, v]) => ({ model, ...v })),
    };
  }

  async latest(name: string, filter?: { host_id?: string; agent_id?: string; tenant_id?: string }): Promise<number | null> {
    for (let i = this.metrics.length - 1; i >= 0; i--) {
      const r = this.metrics[i]!;
      if (
        r.name === name &&
        (!filter?.host_id || r.host_id === filter.host_id) &&
        (!filter?.agent_id || r.agent_id === filter.agent_id) &&
        (!filter?.tenant_id || r.tenant_id === filter.tenant_id)
      ) {
        return r.value;
      }
    }
    return null;
  }

  async close() {
    /* nothing */
  }
}

function aggregate(vals: number[], agg: MetricQuery["agg"]): number {
  if (vals.length === 0) return 0;
  switch (agg) {
    case "sum":
      return vals.reduce((a, b) => a + b, 0);
    case "max":
      return Math.max(...vals);
    case "min":
      return Math.min(...vals);
    case "last":
      return vals[vals.length - 1]!;
    case "avg":
    default:
      return vals.reduce((a, b) => a + b, 0) / vals.length;
  }
}
