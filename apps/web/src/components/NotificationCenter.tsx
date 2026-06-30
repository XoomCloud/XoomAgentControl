"use client";

import { useState } from "react";
import { useApiQuery } from "@/lib/query";
import { fmtRelative } from "@/lib/ui";

interface EventRow {
  id: string;
  eventType: string;
  severity: string;
  message: string;
  createdAt: string;
  tenant?: { slug: string } | null;
}

/** Bell + dropdown of recent error/critical events. Polls every 15s. */
export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const { data } = useApiQuery<{ events: EventRow[] }>("/api/events?severity=error&limit=20", { refetchInterval: 15_000 });
  const count = data?.events.length ?? 0;

  return (
    <div style={{ position: "relative" }}>
      <button className="btn sm" onClick={() => setOpen((o) => !o)} aria-label="Notifications">
        🔔{count > 0 && <span className="badge red" style={{ padding: "0 6px", marginLeft: 6 }}>{count}</span>}
      </button>
      {open && (
        <div className="card" style={{ position: "absolute", right: 0, top: 40, width: 380, zIndex: 40, maxHeight: 420, overflow: "auto" }}>
          <div className="card-title" style={{ marginBottom: 10 }}>Recent alerts</div>
          {count === 0 ? (
            <div className="empty" style={{ padding: 20 }}>Nothing firing. 🎉</div>
          ) : (
            data!.events.map((e) => (
              <div key={e.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="badge red">{e.severity}</span>
                  <span className="faint" style={{ fontSize: 12 }}>{fmtRelative(e.createdAt)}</span>
                </div>
                <div style={{ marginTop: 4 }}>{e.message}</div>
                <div className="mono faint" style={{ fontSize: 12 }}>{e.tenant?.slug ?? "platform"} · {e.eventType}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
