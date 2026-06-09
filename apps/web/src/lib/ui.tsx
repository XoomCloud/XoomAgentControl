"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

/** Minimal data-fetching hook with loading/error/refetch. */
export function useFetch<T>(path: string | null): { data: T | null; error: string | null; loading: boolean; refetch: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoading(true);
    api<T>(path)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, refetch };
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "green",
    online: "green",
    succeeded: "green",
    provisioning: "blue",
    claimed: "blue",
    running: "blue",
    pending: "yellow",
    queued: "yellow",
    draining: "yellow",
    maintenance: "yellow",
    suspended: "gray",
    offline: "gray",
    cancelled: "gray",
    deleted: "gray",
    failed: "red",
    error: "red",
    critical: "red",
  };
  const cls = map[status] ?? "gray";
  return (
    <span className={`badge ${cls}`}>
      <span className="dot" />
      {status}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = { info: "blue", debug: "gray", warning: "yellow", error: "red", critical: "red" };
  return <span className={`badge ${map[severity] ?? "gray"}`}>{severity}</span>;
}

export function Spinner() {
  return <div className="spinner" />;
}

export function Loading() {
  return (
    <div className="row" style={{ padding: 30, justifyContent: "center" }}>
      <Spinner />
      <span className="muted">Loading…</span>
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="error-box">{message}</div>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtRelative(d: string | null | undefined): string {
  if (!d) return "never";
  const diff = Date.now() - new Date(d).getTime();
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
