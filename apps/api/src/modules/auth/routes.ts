import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { LoginRequest, CreateUserRequest, AUDIT_ACTIONS } from "@xoom/shared-types";
import { verifyPassword, signSession, hashPassword, canManageUsers } from "@xoom/auth";
import { recordAudit } from "../../lib/audit.js";

export async function authRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post("/login", { schema: { body: LoginRequest, tags: ["auth"] } }, async (req, reply) => {
    const { email, password } = req.body;
    const user = await app.db.user.findUnique({ where: { email } });
    if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
      return reply.code(401).send({ error: "unauthorized", message: "Invalid credentials" });
    }
    await app.db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const token = signSession(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      { secret: app.config.JWT_SECRET, expiresIn: app.config.JWT_EXPIRES_IN },
    );
    return {
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  });

  app.get("/me", { preHandler: app.requireUser(), schema: { tags: ["auth"], security: [{ bearerAuth: [] }] } }, async (req) => {
    return { user: req.user };
  });

  // --- User management (RBAC: msp_admin+) ---
  app.get("/users", { preHandler: app.requireUser(), schema: { tags: ["auth"] } }, async (req, reply) => {
    if (!canManageUsers(req.user!.role)) return reply.code(403).send({ error: "forbidden" });
    const users = await app.db.user.findMany({
      select: { id: true, email: true, name: true, role: true, active: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    return { users };
  });

  app.post("/users", { preHandler: app.requireUser({ write: true }), schema: { body: CreateUserRequest, tags: ["auth"] } }, async (req, reply) => {
    if (!canManageUsers(req.user!.role)) return reply.code(403).send({ error: "forbidden" });
    const { email, name, password, role } = req.body;
    const existing = await app.db.user.findUnique({ where: { email } });
    if (existing) return reply.code(409).send({ error: "conflict", message: "Email already exists" });
    const user = await app.db.user.create({
      data: { email, name, role, passwordHash: await hashPassword(password) },
      select: { id: true, email: true, name: true, role: true, active: true },
    });
    await recordAudit(app.db, { actorUserId: req.user!.id, ipAddress: req.ip }, AUDIT_ACTIONS.USER_CREATED, {
      targetType: "user",
      targetId: user.id,
      metadata: { email, role },
    });
    return reply.code(201).send({ user });
  });
}
