"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { apiUrl, getToken } from "./api";

interface RealtimeCtx {
  socket: Socket | null;
  connected: boolean;
}
const Ctx = createContext<RealtimeCtx>({ socket: null, connected: false });

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const socket = io(apiUrl, {
      path: "/socket.io",
      auth: { token },
      transports: ["websocket", "polling"],
      reconnectionDelayMax: 10_000,
    });
    socketRef.current = socket;
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, []);

  return <Ctx.Provider value={{ socket: socketRef.current, connected }}>{children}</Ctx.Provider>;
}

export function useRealtimeStatus() {
  return useContext(Ctx).connected;
}

/**
 * Subscribe to a realtime topic and invoke `onEvent` for each `event` message.
 * Automatically (re)subscribes on connect and cleans up on unmount.
 */
export function useTopic(topic: string | null, event: string, onEvent: (payload: unknown) => void) {
  const { socket } = useContext(Ctx);
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    if (!socket || !topic) return;
    const handler = (payload: unknown) => cb.current(payload);
    const subscribe = () => socket.emit("subscribe", topic);
    subscribe();
    socket.on("connect", subscribe);
    socket.on(event, handler);
    return () => {
      socket.emit("unsubscribe", topic);
      socket.off(event, handler);
      socket.off("connect", subscribe);
    };
  }, [socket, topic, event]);
}
