"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { clearSession, getStoredUser, getToken, type SessionUser } from "@/lib/api";
import { CommandPalette } from "@/components/CommandPalette";
import { NotificationCenter } from "@/components/NotificationCenter";
import { useRealtimeStatus } from "@/lib/realtime";

const NAV = [
  { href: "/", label: "Overview", ico: "◈" },
  { href: "/tenants", label: "Tenants", ico: "▣" },
  { href: "/agents", label: "Agents", ico: "✦" },
  { href: "/infrastructure", label: "Infrastructure", ico: "▤" },
  { href: "/deployments", label: "Deployments", ico: "↻" },
  { href: "/providers", label: "AI Providers", ico: "✧" },
  { href: "/mcp", label: "MCP Registry", ico: "⚙" },
  { href: "/integrations", label: "Integrations", ico: "⧉" },
  { href: "/memory", label: "Memory", ico: "◉" },
  { href: "/logs", label: "Logs & Metrics", ico: "≣" },
  { href: "/templates", label: "Agent Templates", ico: "❏" },
  { href: "/settings", label: "Settings", ico: "⚒" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const live = useRealtimeStatus();

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setUser(getStoredUser());
    setReady(true);
  }, [router]);

  if (!ready) return null;

  const current = NAV.find((n) => (n.href === "/" ? pathname === "/" : pathname.startsWith(n.href)));

  function logout() {
    clearSession();
    router.replace("/login");
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" />
          <div>
            <div className="brand-name">XoomAgent</div>
            <div className="brand-sub">Control Platform</div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={active ? "active" : ""}>
                <span className="nav-ico">{n.ico}</span>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <div style={{ color: "var(--text)" }}>{user?.name ?? user?.email}</div>
          <div>{user?.role}</div>
          <button className="btn sm" style={{ marginTop: 8, width: "100%", justifyContent: "center" }} onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-title">{current?.label ?? "XoomAgent"}</div>
          <div className="row">
            <button className="btn sm" onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}>
              ⌘K Search
            </button>
            <NotificationCenter />
            <span className={`badge ${live ? "green" : "gray"}`} title={live ? "Realtime connected" : "Realtime offline (polling)"}>
              <span className="dot" /> {live ? "live" : "polling"}
            </span>
            <span className="badge purple">{user?.role}</span>
          </div>
        </header>
        <CommandPalette />
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
