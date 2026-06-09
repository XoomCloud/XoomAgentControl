"use client";

import { useFetch, Loading, ErrorBox, StatusBadge } from "@/lib/ui";

interface Gateway {
  provider: string;
  base_url: string;
  configured: boolean;
}
interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  runtimeConfig?: { llmConfigJson?: Record<string, unknown> } | null;
}

export default function LlmPage() {
  const { data: gw } = useFetch<Gateway>("/api/llm/gateway");
  const { data, error, loading } = useFetch<{ tenants: Tenant[] }>("/api/tenants");

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">LLM Gateway</div>
          <div className="page-desc">LiteLLM virtual keys, model allowlists, budgets and rate limits per tenant.</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title" style={{ marginBottom: 12 }}>
          Gateway
        </div>
        <dl className="kv">
          <dt>Provider</dt>
          <dd>{gw?.provider ?? "—"}</dd>
          <dt>Endpoint</dt>
          <dd className="mono">{gw?.base_url ?? "—"}</dd>
          <dt>Admin key</dt>
          <dd>{gw?.configured ? <span className="badge green">configured</span> : <span className="badge yellow">not set (placeholder keys)</span>}</dd>
        </dl>
      </div>

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}
      {data && (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Virtual key</th>
                <th>Model allowlist</th>
                <th>Budget</th>
              </tr>
            </thead>
            <tbody>
              {data.tenants.map((t) => {
                const llm = (t.runtimeConfig?.llmConfigJson ?? {}) as Record<string, unknown>;
                const models = (llm.model_allowlist as string[] | undefined) ?? [];
                return (
                  <tr key={t.id}>
                    <td>
                      <strong>{t.name}</strong> <StatusBadge status={t.status} />
                      <div className="mono">{t.slug}</div>
                    </td>
                    <td className="mono">{String(llm.virtual_key_name ?? "—")}</td>
                    <td>{models.length ? models.map((m) => <span key={m} className="tag">{m}</span>) : <span className="faint">all</span>}</td>
                    <td className="mono">${String(llm.max_monthly_spend ?? 0)}/mo</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
