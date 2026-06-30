import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Server, type Socket } from "socket.io";
import { verifySession } from "@xoom/auth";
import { corsOrigins } from "../config.js";

/**
 * Socket.IO realtime gateway. The UI connects with its JWT, subscribes to
 * topics (e.g. `host:<id>:metrics`, `agent:<id>`, `overview`), and the
 * ingestion/command paths publish to those topics via `app.rt.publish(...)`.
 *
 * Single-instance fan-out (in-process). For horizontal scale, swap in the
 * @socket.io/redis-adapter — the publisher API stays identical.
 */
export const realtimePlugin = fp(async function realtimePlugin(app: FastifyInstance) {
  let io: Server | null = null;

  app.decorate("rt", {
    publish(topic: string, event: string, payload: unknown) {
      io?.to(topic).emit(event, payload);
    },
  });

  app.addHook("onReady", async () => {
    io = new Server(app.server, {
      path: "/socket.io",
      cors: { origin: corsOrigins(app.config), credentials: true },
      transports: ["websocket", "polling"],
    });

    // Auth: require a valid admin JWT in the handshake.
    io.use((socket, next) => {
      const token = (socket.handshake.auth?.token as string | undefined) ?? "";
      try {
        const user = verifySession(token, app.config.JWT_SECRET);
        (socket.data as { user?: unknown }).user = user;
        next();
      } catch {
        next(new Error("unauthorized"));
      }
    });

    io.on("connection", (socket: Socket) => {
      socket.on("subscribe", (topic: unknown) => {
        if (typeof topic === "string" && topic.length < 200) void socket.join(topic);
      });
      socket.on("unsubscribe", (topic: unknown) => {
        if (typeof topic === "string") void socket.leave(topic);
      });
    });

    app.log.info("realtime (socket.io) gateway ready at /socket.io");
  });

  app.addHook("onClose", async () => {
    await io?.close();
  });
});
