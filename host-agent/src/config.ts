import os from "node:os";

export interface AgentConfig {
  controlPlaneUrl: string;
  registrationToken: string;
  hostName: string;
  location?: string;
  publicIp?: string;
  privateIp?: string;
  agentVersion: string;
  statePath: string;
  heartbeatIntervalSeconds: number;
  pollIntervalSeconds: number;
  telemetryIntervalSeconds: number;
  // Log directories/files to ship to the Control Center (comma-separated).
  logDirs: string[];
  // Tenant runtimes to poll for live agent state.
  runtimes: { tenant_id: string; type: string; base_url: string; api_key?: string }[];
  // When true the agent simulates Firecracker/SwarmClaw instead of shelling out.
  // Defaults to true so the agent runs on any machine for the MVP.
  mockMode: boolean;
  // Filesystem layout on a real host.
  tenantsDir: string;
  kernelImage: string;
  rootfsBase: string;
}

export const AGENT_VERSION = "0.1.0";

export function loadAgentConfig(): AgentConfig {
  const env = process.env;
  return {
    controlPlaneUrl: env.CONTROL_PLANE_URL ?? "http://localhost:4000",
    registrationToken: env.HOST_REGISTRATION_TOKEN ?? "dev-host-registration-token",
    hostName: env.HOST_NAME ?? os.hostname(),
    location: env.HOST_LOCATION,
    publicIp: env.HOST_PUBLIC_IP,
    privateIp: env.HOST_PRIVATE_IP,
    agentVersion: AGENT_VERSION,
    statePath: env.AGENT_STATE_PATH ?? `${process.cwd()}/.agent-state.json`,
    heartbeatIntervalSeconds: Number(env.HEARTBEAT_INTERVAL_SECONDS ?? 30),
    pollIntervalSeconds: Number(env.POLL_INTERVAL_SECONDS ?? 5),
    telemetryIntervalSeconds: Number(env.TELEMETRY_INTERVAL_SECONDS ?? 15),
    logDirs: (env.XOOM_LOG_DIRS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    runtimes: parseRuntimes(env.XOOM_RUNTIMES),
    mockMode: env.AGENT_MOCK_MODE !== "false",
    tenantsDir: env.TENANTS_DIR ?? "/var/lib/xoomagent/tenants",
    kernelImage: env.FC_KERNEL_IMAGE ?? "/var/lib/xoomagent/images/vmlinux.bin",
    rootfsBase: env.FC_ROOTFS_BASE ?? "/var/lib/xoomagent/images/rootfs.ext4",
  };
}

/** Parse XOOM_RUNTIMES (JSON array) into runtime poller configs. */
function parseRuntimes(raw: string | undefined): AgentConfig["runtimes"] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .map((r) => r as Record<string, unknown>)
      .filter((r) => typeof r.tenant_id === "string" && typeof r.base_url === "string")
      .map((r) => ({
        tenant_id: String(r.tenant_id),
        type: String(r.type ?? "swarmclaw"),
        base_url: String(r.base_url),
        api_key: typeof r.api_key === "string" ? r.api_key : undefined,
      }));
  } catch {
    return [];
  }
}
