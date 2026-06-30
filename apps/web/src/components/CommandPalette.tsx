"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";

interface Item {
  label: string;
  hint?: string;
  href?: string;
  action?: () => void;
  group: string;
}

const NAV_ITEMS: Item[] = [
  { label: "Overview", href: "/", group: "Navigate" },
  { label: "Tenants", href: "/tenants", group: "Navigate" },
  { label: "Agents", href: "/agents", group: "Navigate" },
  { label: "Infrastructure", href: "/infrastructure", group: "Navigate" },
  { label: "Deployments", href: "/deployments", group: "Navigate" },
  { label: "Providers", href: "/providers", group: "Navigate" },
  { label: "MCP Registry", href: "/mcp", group: "Navigate" },
  { label: "Integrations", href: "/integrations", group: "Navigate" },
  { label: "Logs", href: "/logs", group: "Navigate" },
  { label: "Agent Templates", href: "/templates", group: "Navigate" },
  { label: "Settings", href: "/settings", group: "Navigate" },
];

/** Global command palette (Ctrl/Cmd+K). Navigation now; pluggable actions later. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function run(item: Item) {
    setOpen(false);
    if (item.href) router.push(item.href);
    item.action?.();
  }

  if (!open) return null;
  return (
    <div className="cmdk-overlay" onClick={() => setOpen(false)}>
      <div className="cmdk-box" onClick={(e) => e.stopPropagation()}>
        <Command label="Command palette">
          <Command.Input autoFocus placeholder="Search or jump to…  (Esc to close)" className="cmdk-input" />
          <Command.List className="cmdk-list">
            <Command.Empty className="cmdk-empty">No results.</Command.Empty>
            <Command.Group heading="Navigate" className="cmdk-group">
              {NAV_ITEMS.map((it) => (
                <Command.Item key={it.href} value={it.label} onSelect={() => run(it)} className="cmdk-item">
                  {it.label}
                  {it.hint && <span className="faint" style={{ marginLeft: "auto" }}>{it.hint}</span>}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
