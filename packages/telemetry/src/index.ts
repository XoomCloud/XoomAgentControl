import type { IngestBatch, MetricQuery, LogQuery } from "@xoom/shared-types";
import { MemoryStore } from "./memory-store.js";
import { ClickHouseStore } from "./clickhouse-store.js";
import { parseSince } from "./time.js";

export interface MetricSeries {
  name: string;
  points: { ts: number; value: number }[];
}

export interface LogRow {
  ts: number;
  severity: string;
  message: string;
  host_id?: string;
  tenant_id?: string;
  agent_id?: string;
  collector?: string;
  trace_id?: string;
  attributes?: Record<string, unknown>;
}

export interface UsageSummary {
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  by_provider: { provider: string; cost_usd: number; tokens: number }[];
  by_model: { model: string; cost_usd: number; tokens: number }[];
}

export interface TelemetryStore {
  readonly backend: "clickhouse" | "memory";
  ensureSchema(): Promise<void>;
  write(batch: IngestBatch): Promise<void>;
  queryMetrics(q: MetricQuery): Promise<MetricSeries>;
  queryLogs(q: LogQuery): Promise<LogRow[]>;
  usageSummary(opts: { since?: string; tenant_id?: string }): Promise<UsageSummary>;
  latest(name: string, filter?: { host_id?: string; agent_id?: string; tenant_id?: string }): Promise<number | null>;
  close(): Promise<void>;
}

/**
 * Returns a ClickHouse-backed store when CLICKHOUSE_URL is set, otherwise an
 * in-memory ring-buffer store so the Control Center runs end-to-end in dev
 * with no external infra. Same interface either way.
 */
export function createTelemetryStore(env: NodeJS.ProcessEnv = process.env): TelemetryStore {
  if (env.CLICKHOUSE_URL) {
    return new ClickHouseStore({
      url: env.CLICKHOUSE_URL,
      username: env.CLICKHOUSE_USER ?? "default",
      password: env.CLICKHOUSE_PASSWORD ?? "",
      database: env.CLICKHOUSE_DB ?? "default",
    });
  }
  return new MemoryStore();
}

export { MemoryStore, ClickHouseStore, parseSince };
