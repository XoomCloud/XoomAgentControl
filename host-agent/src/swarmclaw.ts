import type { AgentConfig } from "./config.js";
import type { CreateTenantCommandPayload } from "@xoom/shared-types";
import type { MicroVm } from "./firecracker.js";

export interface SwarmClawConfig {
  tenant_id: string;
  tenant_name: string;
  runtime_version: string;
  agent_templates: unknown[];
  skills: string[];
  schedules: unknown[];
  mcp_servers: string[];
  llm_gateway_url?: string;
  litellm_virtual_key_ref?: string;
  memory_namespace?: string;
  memory_provider?: string;
  webhook_callback_url?: string;
  log_forward_url?: string;
}

/**
 * Installs and starts SwarmClaw inside a tenant MicroVM and injects the tenant
 * runtime config. In mock mode it simulates a successful boot and returns a
 * synthetic runtime URL. On a real host this would push the config over the VM
 * agent channel (vsock / SSH-into-VM bootstrap) and start the systemd unit.
 */
export class SwarmClawInstaller {
  constructor(private readonly cfg: AgentConfig) {}

  buildTenantConfig(payload: CreateTenantCommandPayload, tenantId: string | null): SwarmClawConfig {
    return {
      tenant_id: tenantId ?? payload.tenant_slug,
      tenant_name: payload.tenant_name ?? payload.tenant_slug,
      runtime_version: payload.runtime_version,
      agent_templates: [],
      skills: [],
      schedules: [],
      mcp_servers: payload.mcp?.enabled_servers ?? [],
      llm_gateway_url: payload.llm?.base_url,
      litellm_virtual_key_ref: payload.llm?.virtual_key_secret_ref,
      memory_namespace: payload.memory?.namespace,
      memory_provider: payload.memory?.provider,
      webhook_callback_url: payload.webhook_callback_url,
      log_forward_url: payload.log_forward_url,
    };
  }

  async installAndStart(
    vm: MicroVm,
    payload: CreateTenantCommandPayload,
    tenantId: string | null,
  ): Promise<{ runtimeUrl: string; config: SwarmClawConfig }> {
    const config = this.buildTenantConfig(payload, tenantId);
    const runtimeUrl = `https://${payload.tenant_slug}.xoomagent.com`;

    if (this.cfg.mockMode) {
      // Simulate install + health check latency-free.
      return { runtimeUrl, config };
    }

    // Real path (sketch): write config into the VM and start SwarmClaw.
    //   - push config.json to the guest (vsock or guest-agent)
    //   - run the SwarmClaw installer for `runtime_version`
    //   - start the swarmclaw systemd unit
    //   - poll the guest health endpoint until ready
    // These steps are intentionally guarded behind mockMode for the MVP.
    return { runtimeUrl, config };
  }
}
