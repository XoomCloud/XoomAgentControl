"use client";

import Link from "next/link";
import { useFetch, Loading, ErrorBox, StatusBadge, fmtRelative } from "@/lib/ui";

interface Summary {
  tenants: { total: number; active: number; suspended: number; failed: number; offline: number };
  hosts: { total: number; online: number; offline: number };
  commands: { failed: number; pending: number };
  usage: { input_tokens: number; output_tokens: number; spend_usd: number };
  recent_errors: { id: string; message: string; createdAt: string; tenant?: { slug: string } }[];
}

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: string }) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={tone ? { color: `var(--${tone})` } : undefined}>
        {value}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export default function OverviewPage() {
  const { data, error, loading } = useFetch<Summary>("/api/dashboard/summary");

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return null;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Overview</div>
          <div className="page-desc">Fleet-wide tenant, host and spend summary.</div>
        </div>
      </div>

      <div className="grid grid-4">
        <Stat label="Total tenants" value={data.tenants.total} sub={`${data.tenants.active} active`} />
        <Stat label="Active tenants" value={data.tenants.active} tone="green" />
        <Stat label="Offline / suspended" value={data.tenants.suspended + data.tenants.failed} tone="yellow" sub={`${data.tenants.failed} failed`} />
        <Stat label="Hosts online" value={`${data.hosts.online}/${data.hosts.total}`} tone={data.hosts.offline ? "yellow" : "green"} sub={`${data.hosts.offline} offline`} />
      </div>

      <div className="grid grid-4" style={{ marginTop: 16 }}>
        <Stat label="Pending commands" value={data.commands.pending} tone="blue" />
        <Stat label="Failed commands" value={data.commands.failed} tone={data.commands.failed ? "red" : undefined} />
        <Stat label="Tokens used" value={(data.usage.input_tokens + data.usage.output_tokens).toLocaleString()} sub="input + output" />
        <Stat label="LLM spend" value={`$${Number(data.usage.spend_usd).toFixed(2)}`} sub="all tenants" />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-h">
          <div className="card-title">Recent errors & alerts</div>
          <Link href="/logs" className="btn sm">
            View all logs
          </Link>
        </div>
        {data.recent_errors.length === 0 ? (
          <div className="empty">No errors reported. All systems nominal.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Message</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {data.recent_errors.map((e) => (
                <tr key={e.id}>
                  <td className="mono">{e.tenant?.slug ?? "—"}</td>
                  <td>
                    <StatusBadge status="error" /> {e.message}
                  </td>
                  <td className="faint">{fmtRelative(e.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
