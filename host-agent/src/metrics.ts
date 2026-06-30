import os from "node:os";
import { execSync } from "node:child_process";
import { METRICS, type MetricPoint } from "@xoom/shared-types";

export interface HostMetrics {
  cpuUsage: number; // percent
  ramUsage: number; // percent
  diskUsage: number; // percent
}

export interface HostCapacity {
  totalCpu: number;
  totalRamMb: number;
  totalDiskGb: number;
}

/** Point-in-time host utilisation. Best-effort; falls back to load average. */
export function collectMetrics(): HostMetrics {
  const cpus = os.cpus().length || 1;
  const load1 = os.loadavg()[0] ?? 0;
  const cpuUsage = Math.min(100, Math.round((load1 / cpus) * 100));

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const ramUsage = Math.round(((totalMem - freeMem) / totalMem) * 100);

  let diskUsage = 0;
  try {
    const out = execSync("df -kP / | tail -1", { encoding: "utf8" });
    const cols = out.trim().split(/\s+/);
    diskUsage = Number(cols[4]?.replace("%", "") ?? 0);
  } catch {
    diskUsage = 0;
  }

  return { cpuUsage, ramUsage, diskUsage };
}

/** Host metrics as telemetry points (names match @xoom/shared-types METRICS). */
export function collectHostMetricPoints(runningMicrovms: number): MetricPoint[] {
  const m = collectMetrics();
  const ts = Date.now();
  return [
    { name: METRICS.HOST_CPU, value: m.cpuUsage, unit: "percent", ts },
    { name: METRICS.HOST_RAM, value: m.ramUsage, unit: "percent", ts },
    { name: METRICS.HOST_DISK, value: m.diskUsage, unit: "percent", ts },
    { name: METRICS.HOST_UPTIME, value: Math.round(os.uptime()), unit: "seconds", ts },
    { name: METRICS.HOST_MICROVMS, value: runningMicrovms, unit: "count", ts },
  ];
}

/** Best-effort Docker container count (0 if docker absent). */
export function collectDockerContainerCount(): number {
  try {
    const out = execSync("docker ps -q | wc -l", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return Number(out.trim()) || 0;
  } catch {
    return 0;
  }
}

export function collectCapacity(): HostCapacity {
  const totalCpu = os.cpus().length || 1;
  const totalRamMb = Math.round(os.totalmem() / (1024 * 1024));
  let totalDiskGb = 0;
  try {
    const out = execSync("df -kP / | tail -1", { encoding: "utf8" });
    const cols = out.trim().split(/\s+/);
    totalDiskGb = Math.round(Number(cols[1] ?? 0) / (1024 * 1024));
  } catch {
    totalDiskGb = 0;
  }
  return { totalCpu, totalRamMb, totalDiskGb };
}
