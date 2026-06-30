"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/query";
import { Modal } from "@/components/Modal";
import { Loading, ErrorBox, StatusBadge } from "@/lib/ui";

interface ConnectorField { key: string; label: string; type: string; required?: boolean; secret?: boolean; placeholder?: string }
interface ConnectorDef { kind: string; name: string; category: string; description: string; capabilities: string[]; fields: ConnectorField[] }
interface Integration { id: string; kind: string; name: string; enabled: boolean; status: string }

export default function IntegrationsPage() {
  const catalog = useApiQuery<{ catalog: ConnectorDef[] }>("/api/integrations/catalog");
  const installed = useApiQuery<{ integrations: Integration[] }>("/api/integrations", { refetchInterval: 20_000 });
  const [picked, setPicked] = useState<ConnectorDef | null>(null);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Integrations</div>
          <div className="page-desc">Plug-in connectors — runtimes, observability, cloud, comms, PSA. Config forms render from each connector&apos;s schema.</div>
        </div>
      </div>

      {installed.data && installed.data.integrations.length > 0 && (
        <div className="card" style={{ padding: 0, marginBottom: 20 }}>
          <div className="card-h" style={{ padding: "16px 16px 0" }}><div className="card-title">Connected</div></div>
          <table>
            <thead><tr><th>Name</th><th>Kind</th><th>Status</th><th>Enabled</th></tr></thead>
            <tbody>
              {installed.data.integrations.map((i) => (
                <tr key={i.id}><td><strong>{i.name}</strong></td><td className="mono">{i.kind}</td><td><StatusBadge status={i.status === "ok" ? "online" : i.status} /></td><td>{i.enabled ? "yes" : "no"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card-title" style={{ marginBottom: 12 }}>Marketplace</div>
      {catalog.isLoading && <Loading />}
      {catalog.error && <ErrorBox message={(catalog.error as Error).message} />}
      {catalog.data && (
        <div className="grid grid-3">
          {catalog.data.catalog.map((c) => (
            <div key={c.kind} className="card glass">
              <div className="between"><strong>{c.name}</strong><span className="tag">{c.category}</span></div>
              <p className="muted" style={{ minHeight: 38 }}>{c.description}</p>
              <div style={{ marginBottom: 10 }}>{c.capabilities.map((cap) => <span key={cap} className="tag">{cap}</span>)}</div>
              <button className="btn sm primary" onClick={() => setPicked(c)}>Connect</button>
            </div>
          ))}
        </div>
      )}

      {picked && <ConnectDialog def={picked} onClose={() => setPicked(null)} onDone={() => { setPicked(null); installed.refetch(); }} />}
    </>
  );
}

function ConnectDialog({ def, onClose, onDone }: { def: ConnectorDef; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(def.name);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const config: Record<string, unknown> = {};
      for (const f of def.fields) if (!f.secret && values[f.key]) config[f.key] = values[f.key];
      await api("/api/integrations", { method: "POST", body: JSON.stringify({ kind: def.kind, name, config, secret_refs: [], enabled: true }) });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Connect ${def.name}`} onClose={onClose}>
      {err && <ErrorBox message={err} />}
      <div className="field"><label>Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      {def.fields.map((f) => (
        <div className="field" key={f.key}>
          <label>{f.label}{f.required && " *"}{f.secret && " (stored as secret)"}</label>
          <input className="input" type={f.type === "password" ? "password" : "text"} placeholder={f.placeholder} value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
        </div>
      ))}
      <div className="btn-row" style={{ justifyContent: "flex-end" }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || !name} onClick={submit}>{busy ? "Connecting…" : "Connect"}</button>
      </div>
    </Modal>
  );
}
