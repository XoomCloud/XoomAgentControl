// Prisma returns BigInt and Decimal values that JSON.stringify can't handle.
// `jsonSafe` recursively normalises a record into a plain JSON-serialisable
// object: BigInt -> number (string if it overflows), Decimal -> number, Date ->
// ISO string. Used by handlers before returning Prisma rows.

export function jsonSafe<T>(value: T): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
  }
  if (value instanceof Date) return value.toISOString();
  // Prisma Decimal exposes toNumber(); detect by duck-typing.
  if (typeof value === "object" && value !== null && "toNumber" in (value as object)) {
    return Number((value as unknown as { toNumber: () => number }).toNumber());
  }
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = jsonSafe(v);
    }
    return out;
  }
  return value;
}
