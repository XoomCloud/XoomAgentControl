import type { Db } from "@xoom/db";
import type { CreateTenantRequest, TenantAction } from "@xoom/shared-types";
import type { AppConfig } from "../../config.js";
import type { LlmGateway } from "../../lib/providers/llm.js";
import type { MemoryProvider } from "../../lib/providers/memory.js";
import type { SecretsProvider } from "../../lib/secrets.js";
import { encryptValue } from "../../lib/secrets.js";
import { asJson } from "../../lib/json.js";
import { selectHostForTenant, reserveCapacity, releaseCapacity, type RequiredResources } from "../../lib/scheduler.js";
import { recordTenantEvent } from "../../lib/audit.js";

const DEFAULT_LIMITS = {
  vcpu: 2,
  ram_mb: 4096,
  disk_gb: 40,
  max_agents: 5,
  max_monthly_spend: 0,
  max_tokens_per_day: 0,
  max_mcp_tools: 10,
};

export interface TenantServiceDeps {
  db: Db;
  config: AppConfig;
  llm: LlmGateway;
  memory: MemoryProvider;
  secrets: SecretsProvider;
}

export class TenantService {
  constructor(private readonly deps: TenantServiceDeps) {}

  /**
   * Full tenant creation flow (brief §6):
   *  1. create tenant record (pending)
   *  2. select / pin a host with capacity
   *  3. provision LLM virtual key + memory namespace + secret refs
   *  4. persist runtime config
   *  5. enqueue a create_tenant command for the host agent
   */
  async createTenant(input: CreateTenantRequest): Promise<{ tenantId: string; commandId: string | null; status: string }> {
    const { db } = this.deps;

    const existing = await db.tenant.findUnique({ where: { slug: input.slug } });
    if (existing) {
      const err = new Error(`Tenant slug "${input.slug}" already exists`) as Error & { statusCode?: number };
      err.statusCode = 409;
      throw err;
    }

    const limits = { ...DEFAULT_LIMITS, ...(input.resource_limits ?? {}) };
    const required: RequiredResources = { vcpu: limits.vcpu, ram_mb: limits.ram_mb, disk_gb: limits.disk_gb };

    // 1. create pending tenant
    const tenant = await db.tenant.create({
      data: {
        name: input.name,
        slug: input.slug,
        status: "pending",
        runtimeType: input.runtime_type,
        runtimeVersion: input.runtime_version,
        domain: input.domain ?? null,
        resourceLimits: {
          create: {
            vcpu: limits.vcpu,
            ramMb: limits.ram_mb,
            diskGb: limits.disk_gb,
            maxAgents: limits.max_agents,
            maxMonthlySpend: limits.max_monthly_spend,
            maxTokensPerDay: BigInt(limits.max_tokens_per_day),
            maxMcpTools: limits.max_mcp_tools,
          },
        },
      },
    });

    await recordTenantEvent(db, tenant.id, "tenant.created", `Tenant ${input.slug} created (pending)`);

    // 2. select host
    let hostId: string | null = null;
    if (input.auto_select_host !== false && !input.assigned_host_id) {
      hostId = await selectHostForTenant(db, required);
    } else if (input.assigned_host_id) {
      hostId = input.assigned_host_id;
    }

    if (!hostId) {
      await db.tenant.update({ where: { id: tenant.id }, data: { status: "failed" } });
      await recordTenantEvent(db, tenant.id, "tenant.schedule_failed", "No host with sufficient capacity", {
        severity: "error",
      });
      return { tenantId: tenant.id, commandId: null, status: "failed" };
    }

    // 3. provision LLM virtual key + memory namespace, store secret refs
    const memoryNamespace = input.memory?.namespace ?? input.slug;
    const vkey = await this.deps.llm.createVirtualKey({
      tenantSlug: input.slug,
      modelAllowlist: input.llm?.model_allowlist,
      maxBudgetUsd: input.llm?.max_monthly_spend ?? (limits.max_monthly_spend || undefined),
      rpmLimit: input.llm?.rate_limit_rpm,
    });

    const litellmKeyRef = `tenant/${input.slug}/litellm_key`;
    await db.secretReference.create({
      data: {
        tenantId: tenant.id,
        name: "litellm_key",
        provider: "local",
        externalSecretRef: litellmKeyRef,
        encryptedValue: encryptValue(vkey.key, this.deps.config.SECRETS_MASTER_KEY),
      },
    });

    await this.deps.memory.ensureNamespace({ namespace: memoryNamespace, retentionDays: input.memory ? 90 : undefined });

    // resolve agent template -> snapshot into runtime config
    let templateSnapshot: unknown = null;
    if (input.agent_template_id) {
      const tpl = await db.agentTemplate.findUnique({ where: { id: input.agent_template_id } });
      if (tpl) templateSnapshot = tpl;
    }

    // 4. persist runtime config
    const llmConfig = {
      provider: "litellm",
      base_url: input.llm?.base_url ?? this.deps.config.LITELLM_BASE_URL,
      virtual_key_secret_ref: litellmKeyRef,
      model_allowlist: input.llm?.model_allowlist ?? [],
      fallback_models: input.llm?.fallback_models ?? [],
      max_monthly_spend: input.llm?.max_monthly_spend ?? limits.max_monthly_spend,
      rate_limit_rpm: input.llm?.rate_limit_rpm ?? null,
      virtual_key_name: vkey.keyName,
    };
    const memoryConfig = {
      provider: input.memory?.provider ?? "supermemory",
      namespace: memoryNamespace,
      enabled: true,
    };
    const mcpConfig = { enabled_servers: input.mcp_servers ?? [] };

    await db.tenantRuntimeConfig.create({
      data: {
        tenantId: tenant.id,
        swarmclawVersion: input.runtime_version,
        agentTemplatesJson: templateSnapshot ? [templateSnapshot] : [],
        skillsJson: [],
        schedulesJson: [],
        mcpConfigJson: mcpConfig,
        memoryConfigJson: memoryConfig,
        llmConfigJson: llmConfig,
        environmentJson: {},
      },
    });

    // link MCP access rows
    for (const serverName of input.mcp_servers ?? []) {
      const server = await db.mcpServer.findUnique({ where: { name: serverName } });
      if (server) {
        await db.tenantMcpAccess.upsert({
          where: { tenantId_mcpServerId: { tenantId: tenant.id, mcpServerId: server.id } },
          update: { enabled: true, approved: !server.approvalRequired },
          create: { tenantId: tenant.id, mcpServerId: server.id, enabled: true, approved: !server.approvalRequired },
        });
      }
    }

    // assign host + reserve capacity + move to provisioning
    await db.tenant.update({
      where: { id: tenant.id },
      data: { assignedHostId: hostId, status: "provisioning" },
    });
    await reserveCapacity(db, hostId, required);

    // 5. enqueue create_tenant command
    const command = await db.hostCommand.create({
      data: {
        hostId,
        tenantId: tenant.id,
        commandType: "create_tenant",
        status: "queued",
        payloadJson: {
          tenant_slug: input.slug,
          tenant_name: input.name,
          runtime: input.runtime_type,
          runtime_version: input.runtime_version,
          resources: { vcpu: limits.vcpu, ram_mb: limits.ram_mb, disk_gb: limits.disk_gb },
          llm: {
            provider: "litellm",
            base_url: llmConfig.base_url,
            virtual_key_secret_ref: litellmKeyRef,
            model_allowlist: llmConfig.model_allowlist,
          },
          memory: { provider: memoryConfig.provider, namespace: memoryNamespace },
          mcp: { enabled_servers: input.mcp_servers ?? [] },
          webhook_callback_url: `${this.deps.config.API_PUBLIC_URL}/api/tenants/${tenant.id}/callback`,
          log_forward_url: `${this.deps.config.API_PUBLIC_URL}/api/hosts/${hostId}/logs`,
        },
      },
    });

    await recordTenantEvent(db, tenant.id, "command.queued", `Queued create_tenant on host ${hostId}`);

    return { tenantId: tenant.id, commandId: command.id, status: "provisioning" };
  }

  /** Maps a tenant lifecycle action to a host command + status transition. */
  async runAction(tenantId: string, action: TenantAction, runtimeVersion?: string): Promise<{ commandId: string | null }> {
    const { db } = this.deps;
    const tenant = await db.tenant.findUnique({ where: { id: tenantId }, include: { resourceLimits: true } });
    if (!tenant) {
      const err = new Error("Tenant not found") as Error & { statusCode?: number };
      err.statusCode = 404;
      throw err;
    }

    const map: Record<TenantAction, { command?: string; status?: string }> = {
      start: { command: "start_tenant", status: "active" },
      stop: { command: "stop_tenant", status: "suspended" },
      restart: { command: "restart_tenant" },
      backup: { command: "backup_tenant" },
      update_runtime: { command: "update_runtime" },
      suspend: { command: "stop_tenant", status: "suspended" },
      delete: { command: "delete_tenant", status: "deleted" },
    };
    const spec = map[action];

    let commandId: string | null = null;
    if (spec.command && tenant.assignedHostId) {
      const payload: Record<string, unknown> = { tenant_slug: tenant.slug };
      if (action === "update_runtime") {
        payload.runtime_version = runtimeVersion ?? "latest";
        await db.tenant.update({ where: { id: tenantId }, data: { runtimeVersion: runtimeVersion ?? tenant.runtimeVersion } });
      }
      const cmd = await db.hostCommand.create({
        data: {
          hostId: tenant.assignedHostId,
          tenantId,
          commandType: spec.command as never,
          status: "queued",
          payloadJson: asJson(payload),
        },
      });
      commandId = cmd.id;

      if (action === "backup") {
        await db.backup.create({ data: { tenantId, hostId: tenant.assignedHostId, status: "pending" } });
      }
    }

    if (spec.status) {
      await db.tenant.update({ where: { id: tenantId }, data: { status: spec.status as never } });
    }

    // Release reserved capacity when tearing a tenant down.
    if (action === "delete" && tenant.assignedHostId && tenant.resourceLimits) {
      await releaseCapacity(db, tenant.assignedHostId, {
        vcpu: tenant.resourceLimits.vcpu,
        ram_mb: tenant.resourceLimits.ramMb,
        disk_gb: tenant.resourceLimits.diskGb,
      });
    }

    await recordTenantEvent(db, tenantId, `tenant.${action}`, `Action "${action}" requested`, {
      metadata: { commandId },
    });

    return { commandId };
  }
}
