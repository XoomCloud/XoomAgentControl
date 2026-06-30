"use client";

import { useApiQuery } from "@/lib/query";
import { Loading, ErrorBox, StatusBadge } from "@/lib/ui";

interface Provider {
  id: string;
  name: string;
  displayName: string | null;
  baseUrl: string | null;
  enabled: boolean;
  authStatus: string | null;
  usage_24h: { cost_usd: number; tokens: number };
}
interface Resp {
  providers: Provider[];
  gateway: { base_url: string; configured: boolean };
}

export default function ProvidersPage() {
  const { data, error, isLoading } = useApiQuery<Resp>("/api/providers", { refetchInterval: 30_000 });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">AI Providers</div>
          <div className="page-desc">LLM provider health, auth status and rolling 24h cost (via the LiteLLM gateway + usage telemetry).</div>
        </div>
      </div>

      {isLoading && <Loading />}
      {error && <ErrorBox message={(error as Error).message} />}

      {data && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <dl className="kv">
              <dt>Gateway</dt><dd className="mono">{data.gateway.base_url}</dd>
              <dt>Admin key</dt><dd>{data.gateway.configured ? <span className="badge green">configured</span> : <span className="badge yellow">not set</span>}</dd>
            </dl>
          </div>
          <div className="grid grid-3">
            {data.providers.length === 0 && <div className="empty">No providers registered yet.</div>}
            {data.providers.map((p) => (
              <div key={p.id} className="card glass">
                <div className="between">
                  <strong>{p.displayName ?? p.name}</strong>
                  <StatusBadge status={p.enabled ? "online" : "offline"} />
                </div>
                <div className="mono faint" style={{ margin: "4px 0 12px" }}>{p.name}</div>
                <dl className="kv" style={{ gridTemplateColumns: "110px 1fr" }}>
                  <dt>Auth</dt><dd>{p.authStatus ?? "unknown"}</dd>
                  <dt>24h cost</dt><dd>${p.usage_24h.cost_usd.toFixed(2)}</dd>
                  <dt>24h tokens</dt><dd>{p.usage_24h.tokens.toLocaleString()}</dd>
                </dl>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
