"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useFetch, Loading, ErrorBox, StatusBadge, fmtRelative } from "@/lib/ui";
import { Modal } from "@/components/Modal";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  runtimeType: string;
  runtimeVersion: string;
  createdAt: string;
  assignedHost?: { name: string } | null;
  resourceLimits?: { vcpu: number; ramMb: number; diskGb: number } | null;
}
interface TenantList {
  tenants: Tenant[];
  total: number;
}
interface Host {
  id: string;
  name: string;
  derived_status: string;
}
interface Template {
  id: string;
  name: string;
}
interface McpServer {
  id: string;
  name: string;
}

export default function TenantsPage() {
  const { data, error, loading, refetch } = useFetch<TenantList>("/api/tenants");
  const [showCreate, setShowCreate] = useState(false);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Tenants</div>
          <div className="page-desc">Provision and manage isolated agent tenants.</div>
        </div>
        <button className="btn primary" onClick={() => setShowCreate(true)}>
          + Create tenant
        </button>
      </div>

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {data && (
        <div className="card" style={{ padding: 0 }}>
          {data.tenants.length === 0 ? (
            <div className="empty">No tenants yet. Create your first tenant to begin.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Runtime</th>
                  <th>Host</th>
                  <th>Resources</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.tenants.map((t) => (
                  <tr key={t.id} style={{ cursor: "pointer" }}>
                    <td>
                      <Link href={`/tenants/${t.id}`}>
                        <strong>{t.name}</strong>
                        <div className="mono">{t.slug}</div>
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="muted">
                      {t.runtimeType} · {t.runtimeVersion}
                    </td>
                    <td className="muted">{t.assignedHost?.name ?? "—"}</td>
                    <td className="mono">
                      {t.resourceLimits ? `${t.resourceLimits.vcpu}vCPU · ${Math.round(t.resourceLimits.ramMb / 1024)}GB · ${t.resourceLimits.diskGb}GB` : "—"}
                    </td>
                    <td className="faint">{fmtRelative(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showCreate && (
        <CreateTenantDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            refetch();
          }}
        />
      )}
    </>
  );
}

function CreateTenantDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { data: hosts } = useFetch<{ hosts: Host[] }>("/api/hosts");
  const { data: templates } = useFetch<{ templates: Template[] }>("/api/agent-templates");
  const { data: mcp } = useFetch<{ servers: McpServer[] }>("/api/mcp/servers");

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [hostId, setHostId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [vcpu, setVcpu] = useState(2);
  const [ramGb, setRamGb] = useState(4);
  const [diskGb, setDiskGb] = useState(40);
  const [budget, setBudget] = useState(100);
  const [selectedMcp, setSelectedMcp] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      await api("/api/tenants", {
        method: "POST",
        body: JSON.stringify({
          name,
          slug,
          auto_select_host: !hostId,
          assigned_host_id: hostId || null,
          agent_template_id: templateId || undefined,
          mcp_servers: selectedMcp,
          resource_limits: { vcpu, ram_mb: ramGb * 1024, disk_gb: diskGb },
          llm: { max_monthly_spend: budget },
          memory: { namespace: slug },
        }),
      });
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create tenant");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Create tenant" onClose={onClose}>
      {err && <ErrorBox message={err} />}
      <div className="grid grid-2">
        <div className="field">
          <label>Tenant name</label>
          <input
            className="input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slug) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
            }}
            placeholder="Client A"
          />
        </div>
        <div className="field">
          <label>Slug</label>
          <input className="input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="client-a" />
        </div>
      </div>
      <div className="grid grid-2">
        <div className="field">
          <label>Assigned host</label>
          <select className="input" value={hostId} onChange={(e) => setHostId(e.target.value)}>
            <option value="">Auto-select host</option>
            {hosts?.hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} ({h.derived_status})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Agent template</label>
          <select className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">None</option>
            {templates?.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-4">
        <div className="field">
          <label>vCPU</label>
          <input className="input" type="number" value={vcpu} onChange={(e) => setVcpu(+e.target.value)} />
        </div>
        <div className="field">
          <label>RAM (GB)</label>
          <input className="input" type="number" value={ramGb} onChange={(e) => setRamGb(+e.target.value)} />
        </div>
        <div className="field">
          <label>Disk (GB)</label>
          <input className="input" type="number" value={diskGb} onChange={(e) => setDiskGb(+e.target.value)} />
        </div>
        <div className="field">
          <label>Budget ($/mo)</label>
          <input className="input" type="number" value={budget} onChange={(e) => setBudget(+e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>MCP tools</label>
        <div>
          {mcp?.servers.map((s) => {
            const on = selectedMcp.includes(s.name);
            return (
              <span
                key={s.id}
                className="tag"
                style={{ cursor: "pointer", borderColor: on ? "var(--accent)" : undefined, color: on ? "var(--text)" : "var(--text-dim)" }}
                onClick={() => setSelectedMcp((cur) => (on ? cur.filter((x) => x !== s.name) : [...cur, s.name]))}
              >
                {on ? "✓ " : "+ "}
                {s.name}
              </span>
            );
          })}
        </div>
      </div>
      <div className="btn-row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy || !name || !slug} onClick={submit}>
          {busy ? "Provisioning…" : "Create tenant"}
        </button>
      </div>
    </Modal>
  );
}
