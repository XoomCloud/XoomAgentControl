"use client";

import { useFetch, Loading, ErrorBox, StatusBadge } from "@/lib/ui";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
}

export default function MemoryPage() {
  const { data, error, loading } = useFetch<{ tenants: Tenant[] }>("/api/tenants");

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Memory</div>
          <div className="page-desc">Supermemory is the default persistent memory layer. Each tenant gets an isolated namespace.</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <dl className="kv">
          <dt>Default provider</dt>
          <dd>
            <span className="badge purple">Supermemory</span>
          </dd>
          <dt>Isolation</dt>
          <dd className="muted">Per-tenant namespace · per-agent scope · enable/disable sync</dd>
          <dt>Future providers</dt>
          <dd className="muted">Mem0 · Zep · local vector DB (behind provider interface)</dd>
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
                <th>Status</th>
                <th>Namespace</th>
                <th>Provider</th>
              </tr>
            </thead>
            <tbody>
              {data.tenants.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.name}</strong>
                  </td>
                  <td>
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="mono">{t.slug}</td>
                  <td>supermemory</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
