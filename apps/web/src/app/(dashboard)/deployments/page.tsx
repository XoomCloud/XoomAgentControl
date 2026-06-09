"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useFetch, Loading, ErrorBox, StatusBadge, fmtRelative } from "@/lib/ui";

interface Command {
  id: string;
  commandType: string;
  status: string;
  errorMessage: string | null;
  attempts: number;
  createdAt: string;
  completedAt: string | null;
  host?: { name: string } | null;
  tenant?: { slug: string } | null;
}

export default function DeploymentsPage() {
  const [filter, setFilter] = useState("");
  const path = filter ? `/api/commands?status=${filter}` : "/api/commands";
  const { data, error, loading, refetch } = useFetch<{ commands: Command[] }>(path);
  const [busy, setBusy] = useState<string | null>(null);

  async function retry(id: string) {
    setBusy(id);
    try {
      await api(`/api/commands/${id}/retry`, { method: "POST" });
      refetch();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Deployments</div>
          <div className="page-desc">Command queue dispatched to host agents. Retry failed deployments here.</div>
        </div>
        <select className="input" style={{ width: 180 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All statuses</option>
          {["queued", "claimed", "running", "succeeded", "failed", "cancelled"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {data && (
        <div className="card" style={{ padding: 0 }}>
          {data.commands.length === 0 ? (
            <div className="empty">No deployment commands.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Command</th>
                  <th>Tenant</th>
                  <th>Host</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.commands.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.commandType}</td>
                    <td className="mono">{c.tenant?.slug ?? "—"}</td>
                    <td className="muted">{c.host?.name ?? "—"}</td>
                    <td>
                      <StatusBadge status={c.status} />
                      {c.errorMessage && <div className="faint" style={{ color: "var(--red)", fontSize: 12 }}>{c.errorMessage}</div>}
                    </td>
                    <td>{c.attempts}</td>
                    <td className="faint">{fmtRelative(c.createdAt)}</td>
                    <td>
                      {c.status === "failed" && (
                        <button className="btn sm" disabled={busy === c.id} onClick={() => retry(c.id)}>
                          Retry
                        </button>
                      )}
                    </td>
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
