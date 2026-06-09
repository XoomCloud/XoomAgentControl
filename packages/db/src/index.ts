import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

let prisma: PrismaClient | undefined;

/**
 * Returns a process-wide singleton PrismaClient. Re-using one client across the
 * API process avoids exhausting Postgres connections during dev hot-reloads.
 */
export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : ["warn", "error"],
    });
  }
  return prisma;
}

export type Db = PrismaClient;
