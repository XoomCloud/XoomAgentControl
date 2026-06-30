"use client";

import { useState, type ReactNode } from "react";

export interface EntityTab {
  key: string;
  label: string;
  content: ReactNode;
}

/**
 * The shared "entity shell" every major object (agent, host, container,
 * provider, client) renders inside — consistent Overview/Metrics/Logs/Timeline/
 * Relationships/Config/History/Actions tabs so nothing is a dead end.
 */
export function EntityShell({
  title,
  subtitle,
  status,
  actions,
  tabs,
  onBack,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  tabs: EntityTab[];
  onBack?: () => void;
}) {
  const [active, setActive] = useState(tabs[0]?.key);
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="row">
            <div className="page-title">{title}</div>
            {status}
          </div>
          {subtitle && <div className="page-desc">{subtitle}</div>}
        </div>
        <div className="row">
          {actions}
          {onBack && (
            <button className="btn sm" onClick={onBack}>
              ← Back
            </button>
          )}
        </div>
      </div>

      <div className="btn-row" style={{ marginBottom: 16, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            className="btn sm"
            style={{
              borderRadius: 0,
              borderColor: "transparent",
              background: "transparent",
              color: t.key === current?.key ? "var(--text)" : "var(--text-dim)",
              boxShadow: t.key === current?.key ? "inset 0 -2px 0 var(--accent)" : "none",
            }}
            onClick={() => setActive(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div>{current?.content}</div>
    </>
  );
}
