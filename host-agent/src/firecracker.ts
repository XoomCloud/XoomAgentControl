import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { AgentConfig } from "./config.js";
import type { CreateTenantCommandPayload } from "@xoom/shared-types";

export interface MicroVm {
  microvmId: string;
  tenantSlug: string;
  tenantInternalIp: string;
  socketPath: string;
}

/**
 * Manages Firecracker MicroVM lifecycle for tenants. In mock mode (default)
 * everything is simulated so the agent runs on any machine. On a real Hetzner
 * KVM host (mockMode=false) it writes a Firecracker machine config and boots
 * via the firecracker binary against /dev/kvm.
 */
export class FirecrackerManager {
  // In-memory registry of running VMs keyed by tenant slug.
  private readonly vms = new Map<string, MicroVm>();

  constructor(private readonly cfg: AgentConfig) {}

  list(): MicroVm[] {
    return [...this.vms.values()];
  }

  has(tenantSlug: string): boolean {
    return this.vms.has(tenantSlug);
  }

  private tenantDir(slug: string): string {
    return join(this.cfg.tenantsDir, slug);
  }

  /** Allocates a deterministic /24 internal IP for a tenant within 10.80.0.0/16. */
  private allocateIp(slug: string): string {
    let h = 0;
    for (const c of slug) h = (h * 31 + c.charCodeAt(0)) % 60000;
    const octet3 = 1 + (h % 250);
    const octet4 = 10 + (h % 240);
    return `10.80.${octet3}.${octet4}`;
  }

  async createMicrovm(payload: CreateTenantCommandPayload): Promise<MicroVm> {
    const slug = payload.tenant_slug;
    const microvmId = `fc-${slug}`;
    const ip = this.allocateIp(slug);
    const dir = this.tenantDir(slug);
    const socketPath = join(dir, "firecracker.sock");

    if (this.cfg.mockMode) {
      const vm: MicroVm = { microvmId, tenantSlug: slug, tenantInternalIp: ip, socketPath };
      this.vms.set(slug, vm);
      return vm;
    }

    // --- Real provisioning path ---
    mkdirSync(dir, { recursive: true });

    // 1. tenant rootfs: copy the base image (copy-on-write would be used in prod).
    const rootfs = join(dir, "rootfs.ext4");
    if (!existsSync(rootfs)) {
      execFileSync("cp", ["--reflink=auto", this.cfg.rootfsBase, rootfs]);
      // resize to requested disk size
      execFileSync("truncate", ["-s", `${payload.resources.disk_gb}G`, rootfs]);
      execFileSync("resize2fs", [rootfs]);
    }

    // 2. tap interface + nftables NAT (one tap per tenant).
    const tap = `tap-${slug}`.slice(0, 15);
    this.ensureTap(tap, ip);

    // 3. Firecracker machine config.
    const machineConfig = {
      "boot-source": {
        kernel_image_path: this.cfg.kernelImage,
        boot_args: `console=ttyS0 reboot=k panic=1 pci=off ip=${ip}::10.80.0.1:255.255.0.0::eth0:off`,
      },
      drives: [{ drive_id: "rootfs", path_on_host: rootfs, is_root_device: true, is_read_only: false }],
      "machine-config": { vcpu_count: payload.resources.vcpu, mem_size_mib: payload.resources.ram_mb },
      "network-interfaces": [{ iface_id: "eth0", host_dev_name: tap }],
    };
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify(machineConfig, null, 2));

    // 4. boot Firecracker.
    if (existsSync(socketPath)) rmSync(socketPath);
    execFileSync("firecracker", ["--api-sock", socketPath, "--config-file", configPath], {
      stdio: "ignore",
    });

    const vm: MicroVm = { microvmId, tenantSlug: slug, tenantInternalIp: ip, socketPath };
    this.vms.set(slug, vm);
    return vm;
  }

  private ensureTap(tap: string, ip: string): void {
    try {
      execFileSync("ip", ["tuntap", "add", "dev", tap, "mode", "tap"]);
      execFileSync("ip", ["addr", "add", "10.80.0.1/16", "dev", tap]);
      execFileSync("ip", ["link", "set", "dev", tap, "up"]);
      // NAT outbound (egress to shared services / control plane).
      execFileSync("nft", ["add", "rule", "ip", "nat", "postrouting", "ip", "saddr", ip, "masquerade"]);
    } catch {
      // tap may already exist; ignore.
    }
  }

  async stopMicrovm(tenantSlug: string): Promise<void> {
    const vm = this.vms.get(tenantSlug);
    if (!vm) return;
    if (!this.cfg.mockMode) {
      try {
        execFileSync("pkill", ["-f", vm.socketPath], { stdio: "ignore" });
      } catch {
        /* already stopped */
      }
    }
    this.vms.delete(tenantSlug);
  }

  async startMicrovm(tenantSlug: string, payload: CreateTenantCommandPayload): Promise<MicroVm> {
    if (this.vms.has(tenantSlug)) return this.vms.get(tenantSlug)!;
    return this.createMicrovm(payload);
  }

  async deleteMicrovm(tenantSlug: string): Promise<void> {
    await this.stopMicrovm(tenantSlug);
    if (!this.cfg.mockMode) {
      const dir = this.tenantDir(tenantSlug);
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  }
}
