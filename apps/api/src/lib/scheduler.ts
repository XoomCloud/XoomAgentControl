import type { Db } from "@xoom/db";

export interface RequiredResources {
  vcpu: number;
  ram_mb: number;
  disk_gb: number;
}

/**
 * Selects an online, approved host with enough free capacity for the requested
 * resources. Provider-agnostic: works for any host regardless of cloud. Picks
 * the host with the most available RAM (simple bin-packing avoidance) so a
 * single host doesn't get hot-spotted. Returns null when nothing fits.
 */
export async function selectHostForTenant(
  db: Db,
  req: RequiredResources,
): Promise<string | null> {
  const candidates = await db.host.findMany({
    where: {
      status: "online",
      approved: true,
    },
    orderBy: { availableRamMb: "desc" },
  });

  for (const host of candidates) {
    const cpuOk = (host.availableCpu ?? 0) >= req.vcpu;
    const ramOk = (host.availableRamMb ?? 0) >= req.ram_mb;
    const diskOk = (host.availableDiskGb ?? 0) >= req.disk_gb;
    if (cpuOk && ramOk && diskOk) {
      return host.id;
    }
  }
  return null;
}

/**
 * Atomically reserves capacity on a host by decrementing its available pools.
 * Called when a tenant is scheduled onto a host.
 */
export async function reserveCapacity(db: Db, hostId: string, req: RequiredResources): Promise<void> {
  await db.host.update({
    where: { id: hostId },
    data: {
      availableCpu: { decrement: req.vcpu },
      availableRamMb: { decrement: req.ram_mb },
      availableDiskGb: { decrement: req.disk_gb },
    },
  });
}

/** Releases previously reserved capacity (tenant deleted / failed provisioning). */
export async function releaseCapacity(db: Db, hostId: string, req: RequiredResources): Promise<void> {
  await db.host.update({
    where: { id: hostId },
    data: {
      availableCpu: { increment: req.vcpu },
      availableRamMb: { increment: req.ram_mb },
      availableDiskGb: { increment: req.disk_gb },
    },
  });
}
