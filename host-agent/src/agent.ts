import type { AgentConfig } from "./config.js";
import { loadState, saveState, type AgentState } from "./state.js";
import { ControlPlaneClient } from "./api-client.js";
import { collectMetrics, collectCapacity, collectHostMetricPoints, collectDockerContainerCount } from "./metrics.js";
import { FirecrackerManager } from "./firecracker.js";
import { SwarmClawInstaller } from "./swarmclaw.js";
import { CommandExecutor } from "./executor.js";
import { LogShipper } from "./collectors/log-shipper.js";
import { RuntimePoller } from "./collectors/runtime-poller.js";

function log(msg: string, extra?: unknown) {
  const line = { ts: new Date().toISOString(), component: "host-agent", msg, ...(extra ? { extra } : {}) };
  // Structured single-line JSON logging.
  console.log(JSON.stringify(line));
}

export class HostAgent {
  private state: AgentState;
  private readonly client: ControlPlaneClient;
  private readonly fc: FirecrackerManager;
  private readonly executor: CommandExecutor;
  private readonly logShipper: LogShipper;
  private readonly runtimePoller: RuntimePoller;
  private running = false;

  constructor(private readonly cfg: AgentConfig) {
    this.state = loadState(cfg.statePath);
    this.client = new ControlPlaneClient(cfg.controlPlaneUrl, this.state.hostId, this.state.agentKey);
    this.fc = new FirecrackerManager(cfg);
    this.executor = new CommandExecutor(cfg, this.fc, new SwarmClawInstaller(cfg));
    this.logShipper = new LogShipper(cfg.logDirs);
    this.runtimePoller = new RuntimePoller(cfg.runtimes);
  }

  /** Collects host metrics + docker + log lines + runtime agent state and ships it. */
  async shipTelemetry(): Promise<void> {
    try {
      const vms = this.executor.runningVms();
      const metrics = collectHostMetricPoints(vms.length);
      metrics.push({ name: "host.docker.containers", value: collectDockerContainerCount(), unit: "count", ts: Date.now() });
      const logs = this.logShipper.collect();
      await this.client.ingest({ source: { kind: "host", host_id: this.state.hostId }, metrics, logs: logs.length ? logs : undefined });

      const beats = await this.runtimePoller.collect();
      if (beats.length) await this.client.reportAgents(beats);
    } catch (err) {
      log("telemetry ship failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Registers the host if we don't already hold credentials. */
  async ensureRegistered(): Promise<void> {
    if (this.state.hostId && this.state.agentKey) {
      log("using existing host credentials", { hostId: this.state.hostId, approved: this.state.approved });
      return;
    }
    const cap = collectCapacity();
    log("registering host", { hostName: this.cfg.hostName });
    const res = await this.client.registerWithToken(
      {
        host_name: this.cfg.hostName,
        provider: "hetzner",
        location: this.cfg.location,
        public_ip: this.cfg.publicIp,
        private_ip: this.cfg.privateIp,
        host_agent_version: this.cfg.agentVersion,
        firecracker_version: this.cfg.mockMode ? "mock" : undefined,
        capabilities: { kvm: !this.cfg.mockMode, firecracker: true, nftables: !this.cfg.mockMode, docker: false },
        resources: { total_cpu: cap.totalCpu, total_ram_mb: cap.totalRamMb, total_disk_gb: cap.totalDiskGb },
      },
      this.cfg.registrationToken,
    );
    this.state = { hostId: res.host_id, agentKey: res.agent_key, approved: res.approved, registeredAt: new Date().toISOString() };
    saveState(this.cfg.statePath, this.state);
    this.client.setCredentials(res.host_id, res.agent_key);
    log("registered", { hostId: res.host_id, approved: res.approved });
  }

  async sendHeartbeat(): Promise<void> {
    const m = collectMetrics();
    const vms = this.executor.runningVms();
    try {
      const res = await this.client.heartbeat({
        status: "online",
        resources: { cpu_usage: m.cpuUsage, ram_usage: m.ramUsage, disk_usage: m.diskUsage },
        running_microvms: vms.map((v) => ({ tenant_id: v.tenantSlug, status: "running" })),
        firecracker_status: this.cfg.mockMode ? "mock" : "ok",
        agent_status: "ok",
        host_agent_version: this.cfg.agentVersion,
      });
      if (res.pending_commands > 0) log("heartbeat: commands pending", { pending: res.pending_commands });
    } catch (err) {
      log("heartbeat failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  async pollAndRunCommands(): Promise<void> {
    try {
      const cmd = await this.client.nextCommand();
      if (!cmd) return;
      log("claimed command", { id: cmd.command_id, type: cmd.command_type, tenant: cmd.tenant_id });
      // Mark running, execute, report.
      await this.client.reportResult(cmd.command_id, { status: "running", message: "Executing" });
      const result = await this.executor.execute(cmd);
      await this.client.reportResult(cmd.command_id, result);
      log("command completed", { id: cmd.command_id, status: result.status });
    } catch (err) {
      log("command poll failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Main run loop: heartbeat on one cadence, command polling on another. */
  async run(): Promise<void> {
    await this.ensureRegistered();
    if (!this.state.approved) {
      log("host not yet approved by control plane — heartbeating until approved");
    }
    this.running = true;

    await this.sendHeartbeat();
    await this.shipTelemetry();
    const hb = setInterval(() => void this.sendHeartbeat(), this.cfg.heartbeatIntervalSeconds * 1000);
    const poll = setInterval(() => void this.pollAndRunCommands(), this.cfg.pollIntervalSeconds * 1000);
    const tele = setInterval(() => void this.shipTelemetry(), this.cfg.telemetryIntervalSeconds * 1000);

    const shutdown = () => {
      if (!this.running) return;
      this.running = false;
      clearInterval(hb);
      clearInterval(poll);
      clearInterval(tele);
      log("shutting down");
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    log("host agent running", {
      controlPlane: this.cfg.controlPlaneUrl,
      mockMode: this.cfg.mockMode,
      heartbeat: this.cfg.heartbeatIntervalSeconds,
    });
  }
}
