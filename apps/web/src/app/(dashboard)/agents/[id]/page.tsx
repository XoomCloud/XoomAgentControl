"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/query";
import { useTopic } from "@/lib/realtime";
import { MetricArea, appendPoint, type SeriesPoint } from "@/lib/charts";
import { EntityShell } from "@/components/EntityShell";
import { Loading, ErrorBox, StatusBadge, SeverityBadge, fmtDate } from "@/lib/ui";

interface Agent {
  id: string;
  name: string;
  status: string;
  healthScore: number | null;
  currentTask: string | null;
  currentLlm: string | null;
  fallbackModels: string[] | null;
  promptVersion: string | null;
  skillVersion: string | null;
  queueLength: number;
  runtimeType: string;
  lastSeenAt: string | null;
  tenant?: { id: string; slug: string; name: string } | null;
}
interface LogRow { ts: number; severity: string; message: string; collector?: string }

const ACTIONS = ["restart", "pause", "resume", "clone", "export"] as const;

export default function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, error, isLoading, refetch } = useApiQuery<{ agent: Agent }>(`/api/agents/${id}`, { refetchInterval: 15_000 });
  const [busy, setBusy] = useState<string | null>(null);

  // live metric buffers
  const [health, setHealth] = useState<SeriesPoint[]>([]);
  const [resp, setResp] = useState<SeriesPoint[]>([]);
  useTopic(`agent:${id}:metrics`, "metric", (p) => {
    const m = p as { name: string; value: number; ts: number };
    if (m.name === "agent.health_score") setHealth((b) => appendPoint(b, { ts: m.ts, value: m.value }));
    if (m.name === "agent.response_time_ms") setResp((b) => appendPoint(b, { ts: m.ts, value: m.value }));
  });
  useTopic(`agent:${id}`, "agent.update", () => refetch());

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox message={(error as Error).message} />;
  if (!data) return null;
  const a = data.agent;

  async function runAction(action: string) {
    setBusy(action);
    try {
      await api(`/api/agents/${id}/actions`, { method: "POST", body: JSON.stringify({ action }) });
      refetch();
    } finally {
      setBusy(null);
    }
  }

  return (
    <EntityShell
      title={a.name}
      subtitle={<span className="mono">{a.tenant?.slug} · {a.runtimeType}</span>}
      status={<StatusBadge status={a.status} />}
      onBack={() => router.push("/agents")}
      tabs={[
        {
          key: "overview",
          label: "Overview",
          content: (
            <div className="grid grid-2">
              <div className="card">
                <div className="card-title" style={{ marginBottom: 12 }}>State</div>
                <dl className="kv">
                  <dt>Status</dt><dd><StatusBadge status={a.status} /></dd>
                  <dt>Health score</dt><dd>{a.healthScore ?? "—"}</dd>
                  <dt>Current task</dt><dd>{a.currentTask ?? <span className="faint">idle</span>}</dd>
                  <dt>Queue length</dt><dd>{a.queueLength}</dd>
                  <dt>Model</dt><dd className="mono">{a.currentLlm ?? "—"}</dd>
                  <dt>Fallbacks</dt><dd>{(a.fallbackModels ?? []).join(", ") || "—"}</dd>
                  <dt>Prompt / Skill</dt><dd>{a.promptVersion ?? "—"} / {a.skillVersion ?? "—"}</dd>
                  <dt>Tenant</dt><dd>{a.tenant ? <Link href={`/tenants/${a.tenant.id}`}>{a.tenant.name}</Link> : "—"}</dd>
                  <dt>Last seen</dt><dd className="faint">{fmtDate(a.lastSeenAt)}</dd>
                </dl>
              </div>
              <div className="card">
                <div className="card-title" style={{ marginBottom: 12 }}>Health (live)</div>
                <MetricArea data={health} color="var(--green)" />
              </div>
            </div>
          ),
        },
        {
          key: "metrics",
          label: "Metrics",
          content: (
            <div className="grid grid-2">
              <div className="card"><div className="card-title" style={{ marginBottom: 12 }}>Response time (ms)</div><MetricArea data={resp} unit="ms" color="var(--accent-2)" /></div>
              <div className="card"><div className="card-title" style={{ marginBottom: 12 }}>Health score</div><MetricArea data={health} color="var(--green)" /></div>
            </div>
          ),
        },
        { key: "logs", label: "Logs", content: <AgentLogs agentId={id} /> },
        {
          key: "actions",
          label: "Actions",
          content: (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 12 }}>Lifecycle</div>
              <div className="btn-row">
                {ACTIONS.map((act) => (
                  <button key={act} className="btn sm" disabled={busy !== null} onClick={() => runAction(act)}>
                    {busy === act ? "…" : act}
                  </button>
                ))}
              </div>
              <p className="faint" style={{ marginTop: 10 }}>Restart/pause/resume dispatch commands to the agent&apos;s tenant MicroVM.</p>
            </div>
          ),
        },
      ]}
    />
  );
}

function AgentLogs({ agentId }: { agentId: string }) {
  const { data, isLoading } = useApiQuery<{ logs: LogRow[] }>(`/api/telemetry/logs?agent_id=${agentId}&limit=200`, { refetchInterval: 10_000 });
  if (isLoading) return <Loading />;
  return (
    <div className="card" style={{ padding: 0 }}>
      {!data?.logs.length ? (
        <div className="empty">No logs ingested for this agent yet.</div>
      ) : (
        <table>
          <tbody>
            {data.logs.map((l, i) => (
              <tr key={i}>
                <td style={{ width: 80 }}><SeverityBadge severity={l.severity} /></td>
                <td>{l.message}<div className="mono faint">{l.collector ?? ""}</div></td>
                <td className="faint" style={{ width: 150 }}>{fmtDate(new Date(l.ts).toISOString())}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
