import { Prisma } from "@xoom/db";

/**
 * Casts an arbitrary value to a Prisma JSON input. Prisma's generated
 * `InputJsonValue` type doesn't accept loose `Record<string, unknown>` /
 * `unknown[]` shapes, so this is the single sanctioned coercion point.
 * Preserves `undefined` so partial updates skip the field.
 */
export function asJson<T>(v: T): Prisma.InputJsonValue | undefined {
  return v === undefined ? undefined : (v as unknown as Prisma.InputJsonValue);
}
