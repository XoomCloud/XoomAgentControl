# Host Agent

The host agent (`@xoom/host-agent`) runs on each Hetzner KVM host. It is
**outbound-only**: it initiates all connections to the control plane and the
host exposes **no inbound management ports**. The agent:

1. **Registers** the host (once) and stores its credentials.
2. **Heartbeats** host status/metrics on a fixed cadence (default 30s).
3. **Polls** for queued commands, executes them, and **reports results**.
4. **Forwards** tenant/host events as logs.
5. Manages **Firecracker MicroVMs** and installs **SwarmClaw** per tenant (real
   path) or simulates it (mock mode, default).

The CLI (`host-agent/src/index.ts`) supports three subcommands:
`run` (default), `preflight`, and `register`.

---

## Credential model

| Call                         | Auth                                                |
| ---------------------------- | --------------------------------------------------- |
| `POST /api/hosts/register`   | `X-Registration-Token: <HOST_REGISTRATION_TOKEN>`   |
| everything else              | `Authorization: Bearer <agent_key>`                 |

- On register, the control plane mints a **long-lived per-host key** and returns
  it **exactly once** as `agent_key`; only its bcrypt hash is stored
  (`hosts.agentKeyHash`). The agent persists it to its state file
  (`AGENT_STATE_PATH`, mode `0600`).
- **Approval gate:** a freshly registered host is `approved = false`. The
  heartbeat, command-poll, command-result, and logs endpoints **all reject
  unapproved hosts** (`401 "Unknown or unapproved host"`). An operator must call
  `POST /api/hosts/:id/approve` first. The agent will keep heartbeating (and
  logging "host not yet approved") until approval succeeds.

---

## API flow with examples

All request/response shapes come from the Zod contracts in
`packages/shared-types/src/host-agent.ts`.

### 1. Register — `POST /api/hosts/register`

Header: `X-Registration-Token: dev-host-registration-token`

Request (`RegisterHostRequest`):

```json
{
  "host_name": "hetzner-fsn1-01",
  "provider": "hetzner",
  "location": "fsn1",
  "public_ip": "203.0.113.10",
  "private_ip": "10.0.0.10",
  "host_agent_version": "0.1.0",
  "firecracker_version": "1.7.0",
  "capabilities": { "kvm": true, "firecracker": true, "nftables": true, "docker": false },
  "resources": { "total_cpu": 16, "total_ram_mb": 65536, "total_disk_gb": 960 }
}
```

Response `201` (`RegisterHostResponse`):

```json
{
  "host_id": "clx0host123",
  "agent_key": "Yh3...redacted-base64url...",
  "approved": false,
  "heartbeat_interval_seconds": 30
}
```

Registration is **idempotent by host name** — re-registering an existing host
updates its record (and re-issues a key). Available capacity is initialised to
the reported totals.

### 2. Heartbeat — `POST /api/hosts/:host_id/heartbeat`

Header: `Authorization: Bearer <agent_key>` (host must be approved).

Request (`HeartbeatRequest`):

```json
{
  "status": "online",
  "resources": { "cpu_usage": 12.4, "ram_usage": 38.1, "disk_usage": 22.0 },
  "running_microvms": [
    { "tenant_id": "acme", "status": "running" }
  ],
  "firecracker_status": "ok",
  "agent_status": "ok",
  "host_agent_version": "0.1.0"
}
```

Response (`HeartbeatResponse`):

```json
{ "ok": true, "desired_status": null, "pending_commands": 1 }
```

`desired_status` is set to `maintenance`/`draining` when the operator has put the
host into that state. `pending_commands` is a hint of how many `queued` commands
await this host.

### 3. Poll for a command — `GET /api/hosts/:host_id/commands/next`

Header: `Authorization: Bearer <agent_key>`.

Claims the **oldest queued** command for the host (flips it to `claimed`,
increments `attempts`). Response (`NextCommandResponse`) is `null` when nothing
is queued, otherwise:

```json
{
  "command_id": "clx0cmd456",
  "command_type": "create_tenant",
  "tenant_id": "clx0tenant789",
  "payload": { "tenant_slug": "acme", "...": "see CreateTenantCommandPayload" }
}
```

### 4. Report result — `POST /api/hosts/:host_id/commands/:command_id/result`

The agent reports `running` first, then a terminal `succeeded`/`failed`.

Request (`CommandResultRequest`):

```json
{
  "status": "succeeded",
  "message": "Tenant created successfully",
  "result": {
    "microvm_id": "fc-acme",
    "tenant_internal_ip": "10.80.42.71",
    "runtime_url": "https://acme.xoomagent.com"
  }
}
```

Response: `{ "ok": true }`. A terminal result drives **tenant reconciliation**
(see `docs/tenant-lifecycle.md`) and writes a `tenant_events` row.

### 5. Forward logs — `POST /api/hosts/:host_id/logs`

Request (`ForwardLogsRequest`):

```json
{
  "tenant_id": "clx0tenant789",
  "events": [
    {
      "event_type": "agent.started",
      "severity": "info",
      "message": "SwarmClaw runtime is healthy",
      "metadata": { "version": "latest" },
      "ts": "2026-06-06T10:00:00.000Z"
    }
  ]
}
```

Response: `{ "ok": true, "ingested": 1 }`. Events are written to
`tenant_events` when `tenant_id` is present.

---

## Mock mode vs real Firecracker provisioning

`AGENT_MOCK_MODE` defaults to **true** (any value other than `"false"` keeps
mock mode on), so the agent runs on any machine without KVM.

- **Mock mode** (`firecracker.ts`, `swarmclaw.ts`): MicroVMs are tracked in an
  in-memory map; a deterministic internal IP is allocated in `10.80.0.0/16`;
  SwarmClaw "install" returns a synthetic runtime URL
  (`https://<slug>.xoomagent.com`). No host privileges required.
- **Real mode** (`AGENT_MOCK_MODE=false`): for `create_tenant` the agent
  - copies the base rootfs (`FC_ROOTFS_BASE`) into the tenant dir and resizes it
    to the requested disk size,
  - creates a per-tenant tap interface and an nftables NAT (masquerade) rule for
    egress,
  - writes a Firecracker machine config (kernel `FC_KERNEL_IMAGE`, vcpu/ram from
    the payload, boot args wiring the internal IP),
  - boots the `firecracker` binary against `/dev/kvm`,
  - then SwarmClaw is pushed into the guest and started (vsock/guest-agent
    bootstrap; sketched for the MVP).

  These steps require `CAP_NET_ADMIN` + `CAP_SYS_ADMIN` (see the systemd unit).

Command-to-action mapping (`executor.ts`): `create_tenant` → create MicroVM +
install SwarmClaw; `start_tenant` → start MicroVM; `stop_tenant`/`restart_tenant`
→ stop MicroVM; `delete_tenant` → stop + remove tenant dir; `backup_tenant` →
produce an artifact path; `update_runtime`/`collect_logs`/`restore_tenant` are
acknowledged.

---

## Preflight checks

`host-agent preflight` (`preflight.ts`) verifies a host is ready for Firecracker
tenants and exits non-zero if any check fails:

| Check                   | What it verifies                                          |
| ----------------------- | -------------------------------------------------------- |
| `cpu_virtualisation`    | `vmx`/`svm` flag present in `/proc/cpuinfo` (VT-x/AMD-V) |
| `dev_kvm`               | `/dev/kvm` exists                                        |
| `firecracker`           | `firecracker --version` runs (binary installed)         |
| `kernel_version`        | Kernel ≥ 4.14 (Firecracker minimum)                     |
| `disk_space`            | > 20 GB free on `/`                                      |
| `nftables`              | `nft --version` runs                                     |
| `network`              | A default route exists (`ip route | grep default`)      |
| `outbound_control_plane`| `GET <CONTROL_PLANE_URL>/health` reachable              |

---

## systemd install

On a Hetzner KVM host (Ubuntu Server 24.04 LTS), as root, from the built
`host-agent` directory:

```bash
./scripts/install.sh
```

The installer (`scripts/install.sh`):

1. Creates a system `xoomagent` user and the dirs
   `/opt/xoomagent/host-agent`, `/etc/xoomagent`,
   `/var/lib/xoomagent/{tenants,images}`.
2. Copies the built `dist/` (and `node_modules`) into `/opt/xoomagent/host-agent`.
3. Installs the systemd unit and seeds `/etc/xoomagent/agent.env` (chmod 600)
   from `agent.env.example`.
4. Runs `preflight`.

Then edit the env file and enable the service:

```bash
$EDITOR /etc/xoomagent/agent.env      # set CONTROL_PLANE_URL, HOST_REGISTRATION_TOKEN, etc.
systemctl enable --now xoom-host-agent
```

The unit (`systemd/xoom-host-agent.service`) runs `node …/dist/index.js run` as
the `xoomagent` user with `Restart=always`, hardening
(`NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`), and the
`CAP_NET_ADMIN`/`CAP_SYS_ADMIN` capabilities needed for tap/nftables/Firecracker.

---

## Configuration (env vars)

From `host-agent/src/config.ts`:

| Variable                     | Default                                        | Purpose                                               |
| ---------------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| `CONTROL_PLANE_URL`          | `http://localhost:4000`                        | Control-plane base URL (all calls are outbound here). |
| `HOST_REGISTRATION_TOKEN`    | `dev-host-registration-token`                  | Bootstrap token for registration (must match the API).|
| `HOST_NAME`                  | OS hostname                                     | Logical host name (registration is idempotent by it). |
| `HOST_LOCATION`              | —                                              | Reported location (e.g. `fsn1`).                      |
| `HOST_PUBLIC_IP`             | —                                              | Reported public IP.                                   |
| `HOST_PRIVATE_IP`            | —                                              | Reported private IP.                                  |
| `AGENT_STATE_PATH`           | `<cwd>/.agent-state.json`                       | Where host_id + agent_key are persisted (0600).       |
| `HEARTBEAT_INTERVAL_SECONDS` | `30`                                           | Heartbeat cadence.                                    |
| `POLL_INTERVAL_SECONDS`      | `5`                                            | Command-poll cadence.                                 |
| `AGENT_MOCK_MODE`            | `true` (any value but `"false"`)               | Simulate Firecracker/SwarmClaw instead of provisioning.|
| `TENANTS_DIR`                | `/var/lib/xoomagent/tenants`                   | Per-tenant working dir (real mode).                   |
| `FC_KERNEL_IMAGE`            | `/var/lib/xoomagent/images/vmlinux.bin`        | Guest kernel image (real mode).                       |
| `FC_ROOTFS_BASE`            | `/var/lib/xoomagent/images/rootfs.ext4`        | Base rootfs image, copied per tenant (real mode).     |

The agent version is fixed at `0.1.0` (`AGENT_VERSION`).
