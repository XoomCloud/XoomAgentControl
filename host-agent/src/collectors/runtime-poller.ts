import type { AgentHeartbeat, AgentStatus } from "@xoom/shared-types";

export interface RuntimeConfig {
  tenant_id: string;
  type: string; // swarmclaw | openclaw | custom
  base_url: string;
  api_key?: string;
}

/**
 * Polls a tenant runtime (SwarmClaw/OpenClaw) HTTP API for live agent state and
 * normalises it into AgentHeartbeats. Deliberately tolerant: runtimes differ,
 * so it tries a few common endpoints/shapes and skips quietly on failure. Pair
 * with the LogShipper (log folders) for full coverage.
 */
export class RuntimePoller {
  constructor(private readonly runtimes: RuntimeConfig[]) {}

  async collect(): Promise<AgentHeartbeat[]> {
    const out: AgentHeartbeat[] = [];
    for (const rt of this.runtimes) {
      try {
        const agents = await this.fetchAgents(rt);
        for (const a of agents) out.push(a);
      } catch {
        /* runtime unreachable — skip this round */
      }
    }
    return out;
  }

  private async fetchAgents(rt: RuntimeConfig): Promise<AgentHeartbeat[]> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (rt.api_key) headers.authorization = `Bearer ${rt.api_key}`;
    // Try common listing endpoints in order.
    const candidates = ["/api/agents", "/api/v1/agents", "/agents"];
    for (const path of candidates) {
      const res = await fetch(`${rt.base_url.replace(/\/$/, "")}${path}`, { headers, signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (!res || !res.ok) continue;
      const data = (await res.json().catch(() => null)) as unknown;
      const list = Array.isArray(data) ? data : Array.isArray((data as { agents?: unknown[] })?.agents) ? (data as { agents: unknown[] }).agents : null;
      if (!list) continue;
      return list.map((raw) => this.normalize(rt, raw as Record<string, unknown>));
    }
    return [];
  }

  private normalize(rt: RuntimeConfig, a: Record<string, unknown>): AgentHeartbeat {
    const externalId = String(a.id ?? a.agent_id ?? a.name ?? "unknown");
    return {
      tenant_id: rt.tenant_id,
      external_id: externalId,
      status: mapStatus(a.status ?? a.state),
      health_score: numOrUndef(a.health ?? a.health_score),
      current_task: typeof a.current_task === "string" ? a.current_task : (typeof a.task === "string" ? a.task : null),
      queue_length: numOrUndef(a.queue_length ?? a.queue),
      running_jobs: numOrUndef(a.running_jobs ?? a.jobs),
      response_time_ms: numOrUndef(a.response_time_ms ?? a.latency_ms),
      current_llm: typeof a.model === "string" ? a.model : (typeof a.llm === "string" ? a.llm : undefined),
    };
  }
}

function mapStatus(v: unknown): AgentStatus {
  const s = String(v ?? "online").toLowerCase();
  if (["online", "running", "ready", "active"].includes(s)) return "online";
  if (["paused", "stopped"].includes(s)) return "paused";
  if (["degraded", "warning"].includes(s)) return "degraded";
  if (["error", "failed", "crashed"].includes(s)) return "error";
  return "offline";
}

function numOrUndef(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
