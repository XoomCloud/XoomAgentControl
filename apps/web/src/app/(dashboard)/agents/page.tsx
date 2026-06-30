"use client";

import Link from "next/link";
import { useApiQuery } from "@/lib/query";
import { Loading, ErrorBox, StatusBadge, fmtRelative } from "@/lib/ui";

interface Agent {
  id: string;
  name: string;
  status: string;
  healthScore: number | null;
  currentTask: string | null;
  currentLlm: string | null;
  queueLength: number;
  runtimeType: string;
  lastSeenAt: string | null;
  tenant?: { slug: string; name: string } | null;
}

function HealthDot({ score }: { score: number | null }) {
  const color = score == null ? "var(--text-faint)" : score >= 80 ? "var(--green)" : score >= 50 ? "var(--yellow)" : "var(--red)";
  return <span style={{ color }}>{score == null ? "—" : `${score}`}</span>;
}

export default function AgentsPage() {
  const { data, error, isLoading } = useApiQuery<{ agents: Agent[] }>("/api/agents", { refetchInterval: 10_000 });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Agents</div>
          <div className="page-desc">Every deployed agent across all tenants — live health, task, queue and model.</div>
        </div>
      </div>

      {isLoading && <Loading />}
      {error && <ErrorBox message={(error as Error).message} />}

      {data && (
        <div className="card" style={{ padding: 0 }}>
          {data.agents.length === 0 ? (
            <div className="empty">No agents reporting yet. Agents appear once a host&apos;s runtime poller reports them.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Status</th>
                  <th>Health</th>
                  <th>Current task</th>
                  <th>Queue</th>
                  <th>Model</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {data.agents.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/agents/${a.id}`}>
                        <strong>{a.name}</strong>
                        <div className="mono">{a.tenant?.slug ?? "—"} · {a.runtimeType}</div>
                      </Link>
                    </td>
                    <td><StatusBadge status={a.status} /></td>
                    <td><HealthDot score={a.healthScore} /></td>
                    <td className="muted">{a.currentTask ?? <span className="faint">idle</span>}</td>
                    <td>{a.queueLength}</td>
                    <td className="mono">{a.currentLlm ?? "—"}</td>
                    <td className="faint">{fmtRelative(a.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
