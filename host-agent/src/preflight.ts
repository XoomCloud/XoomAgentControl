import { existsSync } from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import type { AgentConfig } from "./config.js";

export interface PreflightCheck {
  name: string;
  ok: boolean;
  detail: string;
}

function tryExec(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/**
 * Verifies a host is ready to run Firecracker tenants (brief §7). Used by the
 * `preflight` CLI command before registering / accepting workloads.
 */
export async function runPreflight(cfg: AgentConfig): Promise<{ checks: PreflightCheck[]; allOk: boolean }> {
  const checks: PreflightCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  // CPU virtualisation
  const cpuinfo = tryExec("grep -E 'vmx|svm' /proc/cpuinfo | head -1") ?? "";
  add("cpu_virtualisation", cpuinfo.length > 0, cpuinfo ? "VT-x/AMD-V present" : "No vmx/svm flag found");

  // /dev/kvm
  add("dev_kvm", existsSync("/dev/kvm"), existsSync("/dev/kvm") ? "/dev/kvm available" : "/dev/kvm missing");

  // Firecracker binary
  const fcVersion = tryExec("firecracker --version");
  add("firecracker", Boolean(fcVersion), fcVersion ?? "firecracker binary not found");

  // Kernel version (>= 4.14 required for Firecracker)
  const release = os.release();
  const major = Number(release.split(".")[0] ?? 0);
  const minor = Number(release.split(".")[1] ?? 0);
  add("kernel_version", major > 4 || (major === 4 && minor >= 14), `kernel ${release}`);

  // Disk space (>20GB free recommended)
  const freeKb = Number(tryExec("df -kP / | tail -1 | awk '{print $4}'") ?? 0);
  add("disk_space", freeKb > 20 * 1024 * 1024, `${Math.round(freeKb / 1024 / 1024)}GB free on /`);

  // nftables
  add("nftables", Boolean(tryExec("nft --version")), tryExec("nft --version") ?? "nft not found");

  // Network config (default route)
  add("network", Boolean(tryExec("ip route | grep default")), tryExec("ip route | grep default") ?? "no default route");

  // Outbound access to control plane
  let outbound = false;
  let outboundDetail = "";
  try {
    const res = await fetch(`${cfg.controlPlaneUrl}/health`, { signal: AbortSignal.timeout(5000) });
    outbound = res.ok;
    outboundDetail = `control plane responded ${res.status}`;
  } catch (err) {
    outboundDetail = `cannot reach ${cfg.controlPlaneUrl}: ${err instanceof Error ? err.message : err}`;
  }
  add("outbound_control_plane", outbound, outboundDetail);

  const allOk = checks.every((c) => c.ok);
  return { checks, allOk };
}
