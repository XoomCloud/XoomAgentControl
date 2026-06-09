"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useFetch, Loading, ErrorBox, StatusBadge, fmtRelative } from "@/lib/ui";

interface Host {
  id: string;
  name: string;
  provider: string;
  location: string | null;
  publicIp: string | null;
  status: string;
  derived_status: string;
  approved: boolean;
  hostAgentVersion: string | null;
  firecrackerVersion: string | null;
  capabilitiesJson?: { kvm?: boolean; firecracker?: boolean; nftables?: boolean } | null;
  totalCpu: number | null;
  totalRamMb: number | null;
  availableCpu: number | null;
  availableRamMb: number | null;
  lastSeenAt: string | null;
  _count?: { tenants: number };
}

export default function HostsPage() {
  const { data, error, loading, refetch } = useFetch<{ hosts: Host[] }>("/api/hosts");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function approve(id: string, approved: boolean) {
    setBusy(id);
    setErr(null);
    try {
      await api(`/api/hosts/${id}/approve`, { method: "POST", body: JSON.stringify({ approved }) });
      refetch();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }
  async function maintenance(id: string, status: string) {
    setBusy(id);
    setErr(null);
    try {
      await api(`/api/hosts/${id}/maintenance`, { method: "POST", body: JSON.stringify({ status }) });
      refetch();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Hosts</div>
          <div className="page-desc">Registered Hetzner Firecracker hosts. Agents connect outbound; no inbound ports required.</div>
        </div>
      </div>

      {loading && <Loading />}
      {err && <ErrorBox message={err} />}
      {error && <ErrorBox message={error} />}

      {data && (
        <div className="card" style={{ padding: 0 }}>
          {data.hosts.length === 0 ? (
            <div className="empty">No hosts registered. Run the host agent with a registration token to enroll a host.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Host</th>
                  <th>Status</th>
                  <th>Capabilities</th>
                  <th>Capacity (free/total)</th>
                  <th>MicroVMs</th>
                  <th>Last seen</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.hosts.map((h) => (
                  <tr key={h.id}>
                    <td>
                      <strong>{h.name}</strong>
                      <div className="mono">
                        {h.provider} · {h.location ?? "—"} · {h.publicIp ?? "no ip"}
                      </div>
                      <div className="faint">agent {h.hostAgentVersion ?? "?"} · fc {h.firecrackerVersion ?? "?"}</div>
                    </td>
                    <td>
                      <StatusBadge status={h.derived_status} />
                      {!h.approved && (
                        <div>
                          <span className="badge yellow" style={{ marginTop: 4 }}>
                            unapproved
                          </span>
                        </div>
                      )}
                    </td>
                    <td>
                      {h.capabilitiesJson?.kvm && <span className="tag">KVM</span>}
                      {h.capabilitiesJson?.firecracker && <span className="tag">Firecracker</span>}
                      {h.capabilitiesJson?.nftables && <span className="tag">nftables</span>}
                    </td>
                    <td className="mono">
                      {h.availableCpu ?? "?"}/{h.totalCpu ?? "?"} vCPU
                      <br />
                      {Math.round((h.availableRamMb ?? 0) / 1024)}/{Math.round((h.totalRamMb ?? 0) / 1024)} GB
                    </td>
                    <td>{h._count?.tenants ?? 0}</td>
                    <td className="faint">{fmtRelative(h.lastSeenAt)}</td>
                    <td>
                      <div className="btn-row">
                        {!h.approved ? (
                          <button className="btn sm primary" disabled={busy === h.id} onClick={() => approve(h.id, true)}>
                            Approve
                          </button>
                        ) : h.status === "maintenance" ? (
                          <button className="btn sm" disabled={busy === h.id} onClick={() => maintenance(h.id, "online")}>
                            Resume
                          </button>
                        ) : (
                          <button className="btn sm" disabled={busy === h.id} onClick={() => maintenance(h.id, "maintenance")}>
                            Maintenance
                          </button>
                        )}
                      </div>
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
