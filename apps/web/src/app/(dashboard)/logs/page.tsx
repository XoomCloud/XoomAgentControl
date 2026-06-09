"use client";

import { useState } from "react";
import { useFetch, Loading, ErrorBox, SeverityBadge, fmtDate } from "@/lib/ui";

type Tab = "events" | "audit" | "usage";

interface Event {
  id: string;
  eventType: string;
  severity: string;
  message: string;
  createdAt: string;
  tenant?: { slug: string } | null;
}
interface Audit {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ipAddress: string | null;
  createdAt: string;
  actor?: { email: string } | null;
}
interface Usage {
  id: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  spendUsd: number;
  windowStart: string;
}

export default function LogsPage() {
  const [tab, setTab] = useState<Tab>("events");

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Logs &amp; Metrics</div>
          <div className="page-desc">Tenant events, audit trail and token usage. (Postgres-backed for MVP; Loki/ClickHouse later.)</div>
        </div>
      </div>

      <div className="btn-row" style={{ marginBottom: 16 }}>
        {(["events", "audit", "usage"] as Tab[]).map((t) => (
          <button key={t} className={`btn sm ${tab === t ? "primary" : ""}`} onClick={() => setTab(t)}>
            {t === "events" ? "Events" : t === "audit" ? "Audit trail" : "Token usage"}
          </button>
        ))}
      </div>

      {tab === "events" && <Events />}
      {tab === "audit" && <AuditTrail />}
      {tab === "usage" && <UsageTable />}
    </>
  );
}

function Events() {
  const { data, error, loading } = useFetch<{ events: Event[] }>("/api/events?limit=200");
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  return (
    <div className="card" style={{ padding: 0 }}>
      {!data?.events.length ? (
        <div className="empty">No events.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Severity</th>
              <th>Tenant</th>
              <th>Event</th>
              <th>Message</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {data.events.map((e) => (
              <tr key={e.id}>
                <td>
                  <SeverityBadge severity={e.severity} />
                </td>
                <td className="mono">{e.tenant?.slug ?? "—"}</td>
                <td className="mono">{e.eventType}</td>
                <td>{e.message}</td>
                <td className="faint">{fmtDate(e.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AuditTrail() {
  const { data, error, loading } = useFetch<{ audit_logs: Audit[] }>("/api/audit-logs?limit=200");
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  return (
    <div className="card" style={{ padding: 0 }}>
      {!data?.audit_logs.length ? (
        <div className="empty">No audit entries.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Action</th>
              <th>Actor</th>
              <th>Target</th>
              <th>IP</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {data.audit_logs.map((a) => (
              <tr key={a.id}>
                <td>
                  <span className="badge purple">{a.action}</span>
                </td>
                <td className="muted">{a.actor?.email ?? "system"}</td>
                <td className="mono">
                  {a.targetType}/{a.targetId?.slice(0, 10)}
                </td>
                <td className="mono faint">{a.ipAddress ?? "—"}</td>
                <td className="faint">{fmtDate(a.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function UsageTable() {
  const { data, error, loading } = useFetch<{ usage: Usage[] }>("/api/usage?limit=200");
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  return (
    <div className="card" style={{ padding: 0 }}>
      {!data?.usage.length ? (
        <div className="empty">No usage metrics recorded yet. Spend is pulled from the LLM gateway when configured.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th>Input</th>
              <th>Output</th>
              <th>Spend</th>
              <th>Window</th>
            </tr>
          </thead>
          <tbody>
            {data.usage.map((u) => (
              <tr key={u.id}>
                <td className="mono">{u.model ?? "—"}</td>
                <td>{u.inputTokens.toLocaleString()}</td>
                <td>{u.outputTokens.toLocaleString()}</td>
                <td>${Number(u.spendUsd).toFixed(4)}</td>
                <td className="faint">{fmtDate(u.windowStart)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
