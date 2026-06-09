import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { ROLE_RANK, type UserRole } from "@xoom/shared-types";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
}

export interface JwtConfig {
  secret: string;
  expiresIn: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signSession(user: SessionUser, cfg: JwtConfig): string {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role, name: user.name }, cfg.secret, {
    expiresIn: cfg.expiresIn as jwt.SignOptions["expiresIn"],
  });
}

export function verifySession(token: string, secret: string): SessionUser {
  const decoded = jwt.verify(token, secret) as jwt.JwtPayload;
  return {
    id: String(decoded.sub),
    email: String(decoded.email),
    name: (decoded.name as string | null) ?? null,
    role: decoded.role as UserRole,
  };
}

/**
 * Role hierarchy check. A user satisfies `required` if their role rank is at
 * least the required role's rank. `tenant_admin` is treated as a side-channel
 * (scoped to its own tenant) and is handled separately by route logic.
 */
export function hasRole(role: UserRole, required: UserRole): boolean {
  return (ROLE_RANK[role] ?? -1) >= (ROLE_RANK[required] ?? 99);
}

/** Roles permitted to perform any mutating (write) action. */
export function canWrite(role: UserRole): boolean {
  return role !== "read_only_auditor";
}

/** Roles permitted to manage other admin users / RBAC. */
export function canManageUsers(role: UserRole): boolean {
  return hasRole(role, "msp_admin");
}

/** Roles permitted destructive tenant/host actions (delete, etc.). */
export function canPerformDestructive(role: UserRole): boolean {
  return hasRole(role, "msp_admin");
}

// --- Host agent credential helpers ---
// Long-lived host agent keys are random tokens stored only as a bcrypt hash.
export async function hashAgentKey(key: string): Promise<string> {
  return bcrypt.hash(key, 10);
}

export async function verifyAgentKey(key: string, hash: string): Promise<boolean> {
  return bcrypt.compare(key, hash);
}
