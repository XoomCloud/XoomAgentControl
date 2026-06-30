"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";

export interface SeriesPoint {
  ts: number;
  value: number;
}

const fmtTime = (ts: number) =>
  new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** Compact realtime area chart used across host/agent/provider dashboards. */
export function MetricArea({
  data,
  color = "var(--accent)",
  unit = "",
  height = 160,
}: {
  data: SeriesPoint[];
  color?: string;
  unit?: string;
  height?: number;
}) {
  if (!data.length) {
    return <div className="empty" style={{ height, display: "grid", placeItems: "center" }}>No data yet</div>;
  }
  const gid = `g-${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.5} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="ts" tickFormatter={fmtTime} stroke="var(--text-faint)" fontSize={11} minTickGap={40} />
        <YAxis stroke="var(--text-faint)" fontSize={11} width={44} />
        <Tooltip
          contentStyle={{ background: "var(--bg-elev-2)", border: "1px solid var(--border-strong)", borderRadius: 8, fontSize: 12 }}
          labelFormatter={(ts) => fmtTime(Number(ts))}
          formatter={(v: number) => [`${Number(v).toFixed(1)}${unit}`, ""]}
        />
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#${gid})`} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Rolling buffer hook: append realtime points, cap length, drop old. */
export function appendPoint(buf: SeriesPoint[], p: SeriesPoint, cap = 120): SeriesPoint[] {
  const next = [...buf, p];
  return next.length > cap ? next.slice(next.length - cap) : next;
}
