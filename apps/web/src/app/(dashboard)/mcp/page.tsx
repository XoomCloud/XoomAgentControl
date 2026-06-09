"use client";

import { useFetch, Loading, ErrorBox, StatusBadge } from "@/lib/ui";

interface McpServer {
  id: string;
  name: string;
  description: string | null;
  transport: string;
  authType: string | null;
  riskLevel: string;
  approvalRequired: boolean;
  enabled: boolean;
}

function RiskBadge({ level }: { level: string }) {
  const map: Record<string, string> = { low: "green", medium: "yellow", high: "orange", critical: "red" };
  return <span className={`badge ${map[level] === "orange" ? "yellow" : map[level] ?? "gray"}`}>{level} risk</span>;
}

export default function McpPage() {
  const { data, error, loading } = useFetch<{ servers: McpServer[] }>("/api/mcp/servers");

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">MCP Registry</div>
          <div className="page-desc">Approved MCP servers. Access is governed per-tenant and per-agent on each tenant&apos;s page.</div>
        </div>
      </div>

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {data && (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Server</th>
                <th>Transport</th>
                <th>Auth</th>
                <th>Risk</th>
                <th>Approval</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.servers.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                    <div className="muted">{s.description}</div>
                  </td>
                  <td className="mono">{s.transport}</td>
                  <td className="muted">{s.authType ?? "none"}</td>
                  <td>
                    <RiskBadge level={s.riskLevel} />
                  </td>
                  <td>{s.approvalRequired ? <span className="badge yellow">required</span> : <span className="badge gray">auto</span>}</td>
                  <td>
                    <StatusBadge status={s.enabled ? "active" : "suspended"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
