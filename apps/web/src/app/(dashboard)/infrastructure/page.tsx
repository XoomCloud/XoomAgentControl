"use client";

import Link from "next/link";
import { useApiQuery } from "@/lib/query";
import { Loading, ErrorBox, StatusBadge, fmtRelative } from "@/lib/ui";

interface Host {
  id: string;
  name: string;
  provider: string;
  location: string | null;
  derived_status: string;
  approved: boolean;
  capabilitiesJson?: { kvm?: boolean; firecracker?: boolean } | null;
  totalCpu: number | null;
  totalRamMb: number | null;
  availableCpu: number | null;
  availableRamMb: number | null;
  lastSeenAt: string | null;
  _count?: { tenants: number };
}

export default function InfrastructurePage() {
  const { data, error, isLoading } = useApiQuery<{ hosts: Host[] }>("/api/hosts", { refetchInterval: 15_000 });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Infrastructure</div>
          <div className="page-desc">Every host in the fleet — Linux KVM, Mac, Docker. Click a host for live metrics.</div>
        </div>
      </div>

      {isLoading && <Loading />}
      {error && <ErrorBox message={(error as Error).message} />}

      {data && (
        <div className="grid grid-3">
          {data.hosts.length === 0 && <div className="empty">No hosts registered.</div>}
          {data.hosts.map((h) => (
            <Link key={h.id} href={`/infrastructure/${h.id}`} className="card glass" style={{ display: "block" }}>
              <div className="between">
                <strong>{h.name}</strong>
                <StatusBadge status={h.derived_status} />
              </div>
              <div className="mono faint" style={{ margin: "4px 0 12px" }}>{h.provider} · {h.location ?? "—"}</div>
              <div className="row" style={{ gap: 6, marginBottom: 10 }}>
                {h.capabilitiesJson?.kvm && <span className="tag">KVM</span>}
                {h.capabilitiesJson?.firecracker && <span className="tag">Firecracker</span>}
                {!h.approved && <span className="badge yellow">unapproved</span>}
              </div>
              <dl className="kv" style={{ gridTemplateColumns: "90px 1fr" }}>
                <dt>vCPU</dt><dd className="mono">{h.availableCpu ?? "?"}/{h.totalCpu ?? "?"}</dd>
                <dt>RAM</dt><dd className="mono">{Math.round((h.availableRamMb ?? 0) / 1024)}/{Math.round((h.totalRamMb ?? 0) / 1024)} GB</dd>
                <dt>Tenants</dt><dd>{h._count?.tenants ?? 0}</dd>
                <dt>Last seen</dt><dd className="faint">{fmtRelative(h.lastSeenAt)}</dd>
              </dl>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
