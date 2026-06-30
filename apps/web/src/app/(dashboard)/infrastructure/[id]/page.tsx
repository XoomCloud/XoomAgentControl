"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/query";
import { useTopic } from "@/lib/realtime";
import { MetricArea, appendPoint, type SeriesPoint } from "@/lib/charts";
import { EntityShell } from "@/components/EntityShell";
import { Loading, ErrorBox, StatusBadge, SeverityBadge, fmtDate } from "@/lib/ui";

interface HostDetail {
  id: string;
  name: string;
  provider: string;
  status: string;
  hostAgentVersion: string | null;
  firecrackerVersion: string | null;
  totalCpu: number | null;
  totalRamMb: number | null;
  totalDiskGb: number | null;
  tenants: { id: string; name: string; slug: string; status: string }[];
  heartbeats: { id: string; cpuUsage: number | null; ramUsage: number | null; runningMicrovms: number; createdAt: string }[];
}
interface MetricSeries { name: string; points: SeriesPoint[] }
interface LogRow { ts: number; severity: string; message: string; collector?: string }

const METRIC_NAMES = ["host.cpu.usage", "host.ram.usage", "host.disk.usage"];

export default function HostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, error, isLoading } = useApiQuery<{ host: HostDetail }>(`/api/hosts/${id}`, { refetchInterval: 30_000 });

  // seed series from history, then live-append
  const [cpu, setCpu] = useState<SeriesPoint[]>([]);
  const [ram, setRam] = useState<SeriesPoint[]>([]);
  const [disk, setDisk] = useState<SeriesPoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      METRIC_NAMES.map((name) => api<MetricSeries>(`/api/telemetry/metrics?name=${name}&host_id=${id}&since=1h&step_seconds=60`)),
    )
      .then(([c, r, d]) => {
        if (cancelled) return;
        setCpu(c.points);
        setRam(r.points);
        setDisk(d.points);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);

  useTopic(`host:${id}:metrics`, "metric", (p) => {
    const m = p as { name: string; value: number; ts: number };
    if (m.name === "host.cpu.usage") setCpu((b) => appendPoint(b, { ts: m.ts, value: m.value }));
    if (m.name === "host.ram.usage") setRam((b) => appendPoint(b, { ts: m.ts, value: m.value }));
    if (m.name === "host.disk.usage") setDisk((b) => appendPoint(b, { ts: m.ts, value: m.value }));
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox message={(error as Error).message} />;
  if (!data) return null;
  const h = data.host;

  return (
    <EntityShell
      title={h.name}
      subtitle={<span className="mono">{h.provider} · agent {h.hostAgentVersion ?? "?"} · fc {h.firecrackerVersion ?? "?"}</span>}
      status={<StatusBadge status={h.status} />}
      onBack={() => router.push("/infrastructure")}
      tabs={[
        {
          key: "metrics",
          label: "Metrics",
          content: (
            <div className="grid grid-3">
              <div className="card"><div className="card-title" style={{ marginBottom: 10 }}>CPU %</div><MetricArea data={cpu} unit="%" /></div>
              <div className="card"><div className="card-title" style={{ marginBottom: 10 }}>RAM %</div><MetricArea data={ram} unit="%" color="var(--accent-2)" /></div>
              <div className="card"><div className="card-title" style={{ marginBottom: 10 }}>Disk %</div><MetricArea data={disk} unit="%" color="var(--yellow)" /></div>
            </div>
          ),
        },
        {
          key: "overview",
          label: "Overview",
          content: (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 12 }}>Capacity</div>
              <dl className="kv">
                <dt>Total</dt><dd>{h.totalCpu ?? "?"} vCPU · {Math.round((h.totalRamMb ?? 0) / 1024)} GB · {h.totalDiskGb ?? "?"} GB</dd>
                <dt>Tenants</dt><dd>{h.tenants.length}</dd>
              </dl>
            </div>
          ),
        },
        {
          key: "microvms",
          label: "MicroVMs / Tenants",
          content: (
            <div className="card" style={{ padding: 0 }}>
              {h.tenants.length === 0 ? (
                <div className="empty">No tenants on this host.</div>
              ) : (
                <table>
                  <thead><tr><th>Tenant</th><th>Slug</th><th>Status</th></tr></thead>
                  <tbody>
                    {h.tenants.map((t) => (
                      <tr key={t.id}><td><strong>{t.name}</strong></td><td className="mono">{t.slug}</td><td><StatusBadge status={t.status} /></td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ),
        },
        { key: "logs", label: "Logs", content: <HostLogs hostId={id} /> },
      ]}
    />
  );
}

function HostLogs({ hostId }: { hostId: string }) {
  const { data, isLoading } = useApiQuery<{ logs: LogRow[] }>(`/api/telemetry/logs?host_id=${hostId}&limit=200`, { refetchInterval: 10_000 });
  if (isLoading) return <Loading />;
  return (
    <div className="card" style={{ padding: 0 }}>
      {!data?.logs.length ? (
        <div className="empty">No logs shipped from this host yet (configure XOOM_LOG_DIRS on the agent).</div>
      ) : (
        <table>
          <tbody>
            {data.logs.map((l, i) => (
              <tr key={i}>
                <td style={{ width: 80 }}><SeverityBadge severity={l.severity} /></td>
                <td>{l.message}<div className="mono faint">{l.collector ?? ""}</div></td>
                <td className="faint" style={{ width: 150 }}>{fmtDate(new Date(l.ts).toISOString())}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
