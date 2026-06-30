"use client";

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "./api";

let client: QueryClient | null = null;
function getClient() {
  if (!client) {
    client = new QueryClient({
      defaultOptions: {
        queries: { staleTime: 5_000, refetchOnWindowFocus: false, retry: 1 },
      },
    });
  }
  return client;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [c] = useState(getClient);
  return <QueryClientProvider client={c}>{children}</QueryClientProvider>;
}

/** Thin wrapper: a GET-backed query keyed by path. Polling fallback via refetchInterval. */
export function useApiQuery<T>(path: string | null, opts?: { refetchInterval?: number; enabled?: boolean }) {
  return useQuery<T>({
    queryKey: [path],
    queryFn: () => api<T>(path as string),
    enabled: opts?.enabled !== false && path != null,
    refetchInterval: opts?.refetchInterval,
  });
}

export { getClient as getQueryClient };
