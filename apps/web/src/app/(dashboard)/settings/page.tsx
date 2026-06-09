"use client";

import { useFetch, Loading, ErrorBox, fmtRelative } from "@/lib/ui";

interface User {
  id: string;
  email: string;
  name: string | null;
  role: string;
  active: boolean;
  lastLoginAt: string | null;
}

const ROLES = [
  { role: "platform_owner", desc: "Full control over the platform and all tenants." },
  { role: "msp_admin", desc: "Manage tenants, hosts, users and destructive actions." },
  { role: "support_engineer", desc: "Operate tenants and deployments; no user management." },
  { role: "read_only_auditor", desc: "View-only access to everything, including audit logs." },
  { role: "tenant_admin", desc: "Scoped to a single tenant (future)." },
];

export default function SettingsPage() {
  const { data: settings } = useFetch<{ settings: Record<string, unknown> }>("/api/settings");
  const { data: users, error, loading } = useFetch<{ users: User[] }>("/api/auth/users");

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-desc">Platform configuration, admin users and RBAC roles.</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title" style={{ marginBottom: 12 }}>
          Platform settings
        </div>
        <pre className="json">{JSON.stringify(settings?.settings ?? {}, null, 2)}</pre>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title" style={{ marginBottom: 12 }}>
          RBAC roles
        </div>
        <dl className="kv">
          {ROLES.map((r) => (
            <div key={r.role} style={{ display: "contents" }}>
              <dt>
                <span className="badge purple">{r.role}</span>
              </dt>
              <dd className="muted">{r.desc}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="card-h" style={{ padding: "18px 18px 0" }}>
          <div className="card-title">Admin users</div>
        </div>
        {loading && <Loading />}
        {error && (
          <div style={{ padding: 18 }}>
            <ErrorBox message={`${error} (requires msp_admin+ role)`} />
          </div>
        )}
        {users && (
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last login</th>
              </tr>
            </thead>
            <tbody>
              {users.users.map((u) => (
                <tr key={u.id}>
                  <td className="mono">{u.email}</td>
                  <td>{u.name ?? "—"}</td>
                  <td>
                    <span className="badge purple">{u.role}</span>
                  </td>
                  <td>{u.active ? <span className="badge green">active</span> : <span className="badge gray">disabled</span>}</td>
                  <td className="faint">{fmtRelative(u.lastLoginAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
