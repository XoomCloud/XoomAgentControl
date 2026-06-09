import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  RegisterHostRequest,
  HeartbeatRequest,
  CommandResultRequest,
  ForwardLogsRequest,
  AUDIT_ACTIONS,
} from "@xoom/shared-types";
import { hashAgentKey } from "@xoom/auth";
import { generateToken } from "../../lib/secrets.js";
import { recordAudit, recordTenantEvent } from "../../lib/audit.js";

const HostParam = z.object({ host_id: z.string() });
const CommandParam = z.object({ host_id: z.string(), command_id: z.string() });

/**
 * Host Agent API. All calls are initiated OUTBOUND by the host agent.
 *   - register: gated by the shared HOST_REGISTRATION_TOKEN
 *   - everything else: gated by the per-host long-lived bearer key
 */
export async function hostAgentRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // POST /api/hosts/register
  app.post("/register", { schema: { body: RegisterHostRequest, tags: ["host-agent"] } }, async (req, reply) => {
    const provided = req.headers["x-registration-token"];
    if (provided !== app.config.HOST_REGISTRATION_TOKEN) {
      return reply.code(401).send({ error: "unauthorized", message: "Invalid registration token" });
    }
    const body = req.body;

    // Mint a long-lived agent key; store only its hash.
    const agentKey = generateToken(32);
    const agentKeyHash = await hashAgentKey(agentKey);

    // Re-register by name updates the existing host record (idempotent bootstrap).
    const existing = await app.db.host.findFirst({ where: { name: body.host_name } });
    const data = {
      name: body.host_name,
      provider: body.provider,
      location: body.location ?? null,
      publicIp: body.public_ip ?? null,
      privateIp: body.private_ip ?? null,
      hostAgentVersion: body.host_agent_version,
      firecrackerVersion: body.firecracker_version ?? null,
      capabilitiesJson: body.capabilities as object,
      totalCpu: body.resources.total_cpu,
      totalRamMb: body.resources.total_ram_mb,
      totalDiskGb: body.resources.total_disk_gb,
      availableCpu: body.resources.total_cpu,
      availableRamMb: body.resources.total_ram_mb,
      availableDiskGb: body.resources.total_disk_gb,
      agentKeyHash,
      status: "online" as const,
      lastSeenAt: new Date(),
    };

    const host = existing
      ? await app.db.host.update({ where: { id: existing.id }, data })
      : await app.db.host.create({ data: { ...data, approved: false } });

    await recordAudit(app.db, { ipAddress: req.ip }, AUDIT_ACTIONS.HOST_REGISTERED, {
      targetType: "host",
      targetId: host.id,
      metadata: { host_name: body.host_name, capabilities: body.capabilities },
    });

    return reply.code(201).send({
      host_id: host.id,
      agent_key: agentKey,
      approved: host.approved,
      heartbeat_interval_seconds: app.config.HEARTBEAT_INTERVAL_SECONDS,
    });
  });

  // POST /api/hosts/:host_id/heartbeat
  app.post(
    "/:host_id/heartbeat",
    { preHandler: app.requireHost(), schema: { params: HostParam, body: HeartbeatRequest, tags: ["host-agent"] } },
    async (req) => {
      const body = req.body;
      const hostId = req.hostId!;

      await app.db.hostHeartbeat.create({
        data: {
          hostId,
          cpuUsage: body.resources.cpu_usage ?? null,
          ramUsage: body.resources.ram_usage ?? null,
          diskUsage: body.resources.disk_usage ?? null,
          runningMicrovms: body.running_microvms.length,
          firecrackerStatus: body.firecracker_status ?? null,
          agentStatus: body.agent_status ?? null,
          rawJson: body as object,
        },
      });

      const host = await app.db.host.update({
        where: { id: hostId },
        data: {
          status: body.status,
          lastSeenAt: new Date(),
          hostAgentVersion: body.host_agent_version ?? undefined,
        },
      });

      const pending = await app.db.hostCommand.count({ where: { hostId, status: "queued" } });

      return {
        ok: true as const,
        desired_status: host.status === "maintenance" || host.status === "draining" ? host.status : undefined,
        pending_commands: pending,
      };
    },
  );

  // GET /api/hosts/:host_id/commands/next  (claim the oldest queued command)
  app.get(
    "/:host_id/commands/next",
    { preHandler: app.requireHost(), schema: { params: HostParam, tags: ["host-agent"] } },
    async (req) => {
      const hostId = req.hostId!;
      // Atomic claim: select oldest queued, flip to claimed.
      const next = await app.db.hostCommand.findFirst({
        where: { hostId, status: "queued" },
        orderBy: { createdAt: "asc" },
      });
      if (!next) return null;

      const claimed = await app.db.hostCommand.update({
        where: { id: next.id },
        data: { status: "claimed", claimedAt: new Date(), attempts: { increment: 1 } },
      });

      return {
        command_id: claimed.id,
        command_type: claimed.commandType,
        tenant_id: claimed.tenantId,
        payload: claimed.payloadJson ?? {},
      };
    },
  );

  // POST /api/hosts/:host_id/commands/:command_id/result
  app.post(
    "/:host_id/commands/:command_id/result",
    { preHandler: app.requireHost(), schema: { params: CommandParam, body: CommandResultRequest, tags: ["host-agent"] } },
    async (req, reply) => {
      const { command_id } = req.params;
      const body = req.body;
      const command = await app.db.hostCommand.findFirst({ where: { id: command_id, hostId: req.hostId! } });
      if (!command) return reply.code(404).send({ error: "not_found" });

      const completed = body.status === "succeeded" || body.status === "failed";
      await app.db.hostCommand.update({
        where: { id: command.id },
        data: {
          status: body.status,
          resultJson: (body.result ?? {}) as object,
          errorMessage: body.error ?? null,
          completedAt: completed ? new Date() : null,
        },
      });

      // Reconcile tenant status from command outcome.
      if (command.tenantId) {
        await reconcileTenant(app, command.tenantId, command.commandType, body.status, body.result);
        await recordTenantEvent(app.db, command.tenantId, "command.result", `${command.commandType} -> ${body.status}`, {
          severity: body.status === "failed" ? "error" : "info",
          metadata: { command_id: command.id, message: body.message, error: body.error },
        });
      }

      await recordAudit(app.db, { ipAddress: req.ip }, AUDIT_ACTIONS.COMMAND_EXECUTED, {
        targetType: "command",
        targetId: command.id,
        metadata: { status: body.status, type: command.commandType },
      });

      return { ok: true };
    },
  );

  // POST /api/hosts/:host_id/logs  (forwarded tenant/host events)
  app.post(
    "/:host_id/logs",
    { preHandler: app.requireHost(), schema: { params: HostParam, body: ForwardLogsRequest, tags: ["host-agent"] } },
    async (req) => {
      const body = req.body;
      if (body.tenant_id) {
        for (const e of body.events) {
          await recordTenantEvent(app.db, body.tenant_id, e.event_type, e.message, {
            severity: e.severity,
            metadata: e.metadata,
          });
        }
      }
      return { ok: true, ingested: body.events.length };
    },
  );
}

// Helper kept off the route object; attached via call(this) above is avoided —
// declare as a standalone module function instead.
async function reconcileTenant(
  app: FastifyInstance,
  tenantId: string,
  commandType: string,
  status: string,
  result?: Record<string, unknown>,
) {
  const succeeded = status === "succeeded";
  const transitions: Record<string, { ok?: string; fail?: string }> = {
    create_tenant: { ok: "active", fail: "failed" },
    start_tenant: { ok: "active" },
    restart_tenant: { ok: "active" },
    stop_tenant: { ok: "suspended" },
    delete_tenant: { ok: "deleted" },
  };
  const t = transitions[commandType];
  if (!t) return;
  const newStatus = succeeded ? t.ok : t.fail;
  if (!newStatus) return;

  const data: Record<string, unknown> = { status: newStatus };
  if (succeeded && result?.runtime_url) data.domain = String(result.runtime_url);
  await app.db.tenant.update({ where: { id: tenantId }, data });

  if (commandType === "backup_tenant" && succeeded) {
    await app.db.backup.updateMany({
      where: { tenantId, status: "pending" },
      data: {
        status: "succeeded",
        artifactPath: result?.artifact_path ? String(result.artifact_path) : null,
        completedAt: new Date(),
      },
    });
  }
}
