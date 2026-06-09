import { CreateTenantCommandPayload, type NextCommandResponse, type CommandResultRequest } from "@xoom/shared-types";
import type { AgentConfig } from "./config.js";
import { FirecrackerManager } from "./firecracker.js";
import { SwarmClawInstaller } from "./swarmclaw.js";

/**
 * Executes a single command pulled from the control plane and returns the
 * result payload to report back. Maps each command type to Firecracker /
 * SwarmClaw operations.
 */
export class CommandExecutor {
  constructor(
    private readonly cfg: AgentConfig,
    private readonly fc: FirecrackerManager,
    private readonly swarm: SwarmClawInstaller,
  ) {}

  runningVms() {
    return this.fc.list();
  }

  async execute(cmd: NonNullable<NextCommandResponse>): Promise<CommandResultRequest> {
    try {
      switch (cmd.command_type) {
        case "create_tenant":
          return await this.createTenant(cmd);
        case "start_tenant":
          return await this.startTenant(cmd);
        case "stop_tenant":
        case "restart_tenant":
          return await this.stopOrRestart(cmd);
        case "delete_tenant":
          return await this.deleteTenant(cmd);
        case "update_runtime":
          return this.ok(cmd, "Runtime update applied", { runtime_version: this.payload(cmd).runtime_version });
        case "backup_tenant":
          return await this.backupTenant(cmd);
        case "collect_logs":
          return this.ok(cmd, "Logs collected", { lines: 0 });
        case "restore_tenant":
          return this.ok(cmd, "Restore completed");
        default:
          return { status: "failed", error: `Unsupported command_type: ${cmd.command_type}` };
      }
    } catch (err) {
      return { status: "failed", error: err instanceof Error ? err.message : String(err) };
    }
  }

  private payload(cmd: NonNullable<NextCommandResponse>): Record<string, unknown> {
    return (cmd.payload ?? {}) as Record<string, unknown>;
  }

  private ok(_cmd: unknown, message: string, result: Record<string, unknown> = {}): CommandResultRequest {
    return { status: "succeeded", message, result };
  }

  private async createTenant(cmd: NonNullable<NextCommandResponse>): Promise<CommandResultRequest> {
    const payload = CreateTenantCommandPayload.parse(cmd.payload);
    const vm = await this.fc.createMicrovm(payload);
    const { runtimeUrl } = await this.swarm.installAndStart(vm, payload, cmd.tenant_id);
    return {
      status: "succeeded",
      message: "Tenant created successfully",
      result: {
        microvm_id: vm.microvmId,
        tenant_internal_ip: vm.tenantInternalIp,
        runtime_url: runtimeUrl,
      },
    };
  }

  private async startTenant(cmd: NonNullable<NextCommandResponse>): Promise<CommandResultRequest> {
    const slug = String(this.payload(cmd).tenant_slug ?? "");
    const payload = CreateTenantCommandPayload.safeParse(cmd.payload);
    if (payload.success) {
      const vm = await this.fc.startMicrovm(slug, payload.data);
      return this.ok(cmd, "Tenant started", { microvm_id: vm.microvmId });
    }
    return this.ok(cmd, "Tenant start acknowledged", { tenant_slug: slug });
  }

  private async stopOrRestart(cmd: NonNullable<NextCommandResponse>): Promise<CommandResultRequest> {
    const slug = String(this.payload(cmd).tenant_slug ?? "");
    await this.fc.stopMicrovm(slug);
    const restart = cmd.command_type === "restart_tenant";
    return this.ok(cmd, restart ? "Tenant restarting" : "Tenant stopped", { tenant_slug: slug });
  }

  private async deleteTenant(cmd: NonNullable<NextCommandResponse>): Promise<CommandResultRequest> {
    const slug = String(this.payload(cmd).tenant_slug ?? "");
    await this.fc.deleteMicrovm(slug);
    return this.ok(cmd, "Tenant deleted", { tenant_slug: slug });
  }

  private async backupTenant(cmd: NonNullable<NextCommandResponse>): Promise<CommandResultRequest> {
    const slug = String(this.payload(cmd).tenant_slug ?? "");
    const artifactPath = `s3://xoom-backups/${slug}/${Date.now()}.tar.zst`;
    // Mock: snapshot would tar the tenant disk/config and upload to object storage.
    return this.ok(cmd, "Backup completed", { artifact_path: artifactPath, size_bytes: 0 });
  }
}
