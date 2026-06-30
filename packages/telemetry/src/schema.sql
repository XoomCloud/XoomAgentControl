-- ClickHouse schema for XoomAgent Control Center telemetry.
-- Applied by ClickHouseStore.ensureSchema(). One column store for
-- metrics + logs + spans + conversation/usage events.

CREATE TABLE IF NOT EXISTS metrics (
  ts            DateTime64(3),
  name          LowCardinality(String),
  value         Float64,
  unit          LowCardinality(String) DEFAULT '',
  host_id       String DEFAULT '',
  tenant_id     String DEFAULT '',
  agent_id      String DEFAULT '',
  source_kind   LowCardinality(String) DEFAULT '',
  attributes    String DEFAULT '{}'
) ENGINE = MergeTree
ORDER BY (name, host_id, tenant_id, agent_id, ts)
TTL toDateTime(ts) + INTERVAL 90 DAY;

CREATE TABLE IF NOT EXISTS logs (
  ts            DateTime64(3),
  severity      LowCardinality(String),
  message       String,
  host_id       String DEFAULT '',
  tenant_id     String DEFAULT '',
  agent_id      String DEFAULT '',
  source_kind   LowCardinality(String) DEFAULT '',
  collector     LowCardinality(String) DEFAULT '',
  trace_id      String DEFAULT '',
  span_id       String DEFAULT '',
  attributes    String DEFAULT '{}'
) ENGINE = MergeTree
ORDER BY (ts)
TTL toDateTime(ts) + INTERVAL 30 DAY;

CREATE TABLE IF NOT EXISTS spans (
  start_ts        DateTime64(3),
  end_ts          DateTime64(3),
  duration_ms     Float64,
  trace_id        String,
  span_id         String,
  parent_span_id  String DEFAULT '',
  name            String,
  kind            LowCardinality(String),
  status          LowCardinality(String),
  tenant_id       String DEFAULT '',
  agent_id        String DEFAULT '',
  attributes      String DEFAULT '{}'
) ENGINE = MergeTree
ORDER BY (trace_id, start_ts)
TTL toDateTime(start_ts) + INTERVAL 14 DAY;

CREATE TABLE IF NOT EXISTS conversation_events (
  ts              DateTime64(3),
  conversation_id String,
  agent_id        String DEFAULT '',
  tenant_id       String DEFAULT '',
  event           LowCardinality(String),
  role            LowCardinality(String) DEFAULT '',
  model           LowCardinality(String) DEFAULT '',
  tokens_in       UInt32 DEFAULT 0,
  tokens_out      UInt32 DEFAULT 0,
  duration_ms     Float64 DEFAULT 0,
  attributes      String DEFAULT '{}'
) ENGINE = MergeTree
ORDER BY (tenant_id, ts)
TTL toDateTime(ts) + INTERVAL 90 DAY;

CREATE TABLE IF NOT EXISTS usage_events (
  ts          DateTime64(3),
  provider    LowCardinality(String),
  model       LowCardinality(String),
  tenant_id   String DEFAULT '',
  agent_id    String DEFAULT '',
  tokens_in   UInt32 DEFAULT 0,
  tokens_out  UInt32 DEFAULT 0,
  cost_usd    Float64 DEFAULT 0,
  latency_ms  Float64 DEFAULT 0,
  status      LowCardinality(String) DEFAULT 'ok'
) ENGINE = MergeTree
ORDER BY (tenant_id, provider, ts)
TTL toDateTime(ts) + INTERVAL 365 DAY;
