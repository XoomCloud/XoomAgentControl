"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useFetch, Loading, ErrorBox, StatusBadge, SeverityBadge, fmtDate, fmtRelative } from "@/lib/ui";

interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  status: string;
  runtimeType: string;
  runtimeVersion: string;
  domain: string | null;
  createdAt: string;
  assignedHost?: { id: string; name: string; status: string } | null;
  resourceLimits?: { vcpu: number; ramMb: number; diskGb: number; maxAgents: number; maxMonthlySpend: number; maxMcpTools: number } | null;
  runtimeConfig?: { llmConfigJson?: Record<string, unknown>; memoryConfigJson?: Record<string, unknown>; mcpConfigJson?: Record<string, unknown> } | null;
  mcpAccess?: { id: string; enabled: boolean; mcpServer: { name: string; riskLevel: string } }[];
  events?: { id: string; eventType: string; severity: string; message: string; createdAt: string }[];
  commands?: { id: string; commandType: string; status: string; createdAt: string }[];
  backups?: { id: string; status: string; createdAt: string; artifactPath: string | null }[];
}

const ACTIONS: { action: string; label: string; danger?: boolean }[] = [
  { action: "start", label: "Start" },
  { action: "stop", label: "Stop" },
  { action: "restart", label: "Restart" },
  { action: "backup", label: "Backup" },
  { action: "update_runtime", label: "Update runtime" },
  { action: "suspend", label: "Suspend", danger: true },
  { action: "delete", label: "Delete", danger: true },
];

export default function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, error, loading, refetch } = useFetch<{ tenant: TenantDetail }>(`/api/tenants/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  async function runAction(action: string) {
    if ((action === "delete" || action === "suspend") && !confirm(`Confirm: ${action} this tenant?`)) return;
    setBusy(action);
    setActionErr(null);
    try {
      const body: Record<string, unknown> = { action };
      if (action === "update_runtime") body.runtime_version = prompt("Runtime version", "latest") ?? "latest";
      await api(`/api/tenants/${id}/actions`, { method: "POST", body: JSON.stringify(body) });
      if (action === "delete") {
        router.push("/tenants");
        return;
      }
      refetch();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return null;
  const t = data.tenant;
  const llm = (t.runtimeConfig?.llmConfigJson ?? {}) as Record<string, unknown>;
  const mem = (t.runtimeConfig?.memoryConfigJson ?? {}) as Record<string, unknown>;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="row">
            <div className="page-title">{t.name}</div>
            <StatusBadge status={t.status} />
          </div>
          <div className="page-desc mono">{t.slug}</div>
        </div>
        <button className="btn sm" onClick={() => router.push("/tenants")}>
          ← Back
        </button>
      </div>

      {actionErr && <ErrorBox message={actionErr} />}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title" style={{ marginBottom: 12 }}>
          Actions
        </div>
        <div className="btn-row">
          {ACTIONS.map((a) => (
            <button key={a.action} className={`btn sm ${a.danger ? "danger" : ""}`} disabled={busy !== null} onClick={() => runAction(a.action)}>
              {busy === a.action ? "…" : a.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-title" style={{ marginBottom: 12 }}>
            Configuration
          </div>
          <dl className="kv">
            <dt>Status</dt>
            <dd>
              <StatusBadge status={t.status} />
            </dd>
            <dt>Assigned host</dt>
            <dd>{t.assignedHost ? `${t.assignedHost.name} (${t.assignedHost.status})` : "—"}</dd>
            <dt>Runtime</dt>
            <dd>
              {t.runtimeType} · {t.runtimeVersion}
            </dd>
            <dt>Runtime URL</dt>
            <dd className="mono">{t.domain ?? "—"}</dd>
            <dt>Resources</dt>
            <dd>
              {t.resourceLimits ? `${t.resourceLimits.vcpu} vCPU · ${Math.round(t.resourceLimits.ramMb / 1024)} GB RAM · ${t.resourceLimits.diskGb} GB disk` : "—"}
            </dd>
            <dt>Limits</dt>
            <dd>{t.resourceLimits ? `${t.resourceLimits.maxAgents} agents · ${t.resourceLimits.maxMcpTools} MCP tools` : "—"}</dd>
            <dt>Created</dt>
            <dd className="faint">{fmtDate(t.createdAt)}</dd>
          </dl>
        </div>

        <div className="card">
          <div className="card-title" style={{ marginBottom: 12 }}>
            LLM &amp; Memory
          </div>
          <dl className="kv">
            <dt>LLM provider</dt>
            <dd>{String(llm.provider ?? "—")}</dd>
            <dt>Gateway URL</dt>
            <dd className="mono">{String(llm.base_url ?? "—")}</dd>
            <dt>Virtual key ref</dt>
            <dd className="mono">{String(llm.virtual_key_secret_ref ?? "—")}</dd>
            <dt>Budget</dt>
            <dd>${String(llm.max_monthly_spend ?? 0)}/mo</dd>
            <dt>Memory</dt>
            <dd>
              {String(mem.provider ?? "—")} · ns: <span className="mono">{String(mem.namespace ?? "—")}</span>
            </dd>
          </dl>
          <div className="sep" />
          <div className="card-title" style={{ marginBottom: 8 }}>
            MCP tools
          </div>
          <div>
            {t.mcpAccess && t.mcpAccess.length > 0 ? (
              t.mcpAccess.map((m) => (
                <span key={m.id} className={`tag`} style={{ color: m.enabled ? "var(--text)" : "var(--text-faint)" }}>
                  {m.enabled ? "✓ " : "○ "}
                  {m.mcpServer.name}
                </span>
              ))
            ) : (
              <span className="faint">No MCP tools assigned</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-title" style={{ marginBottom: 12 }}>
            Recent events
          </div>
          {t.events && t.events.length > 0 ? (
            <table>
              <tbody>
                {t.events.map((e) => (
                  <tr key={e.id}>
                    <td style={{ width: 80 }}>
                      <SeverityBadge severity={e.severity} />
                    </td>
                    <td>
                      {e.message}
                      <div className="mono">{e.eventType}</div>
                    </td>
                    <td className="faint" style={{ width: 90 }}>
                      {fmtRelative(e.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="faint">No events.</div>
          )}
        </div>
        <div className="card">
          <div className="card-title" style={{ marginBottom: 12 }}>
            Deployment commands
          </div>
          {t.commands && t.commands.length > 0 ? (
            <table>
              <tbody>
                {t.commands.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.commandType}</td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="faint" style={{ width: 90 }}>
                      {fmtRelative(c.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="faint">No commands.</div>
          )}
          {t.backups && t.backups.length > 0 && (
            <>
              <div className="sep" />
              <div className="card-title" style={{ marginBottom: 8 }}>
                Backups
              </div>
              {t.backups.map((b) => (
                <div key={b.id} className="between" style={{ padding: "4px 0" }}>
                  <span className="mono faint">{b.artifactPath ?? "pending"}</span>
                  <StatusBadge status={b.status} />
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}
