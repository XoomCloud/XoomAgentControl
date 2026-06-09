// Memory provider abstraction. Default is Supermemory. Future providers (Mem0,
// Zep, local vector DB) implement the same interface.

export interface MemoryNamespaceSpec {
  namespace: string;
  retentionDays?: number;
}

export interface MemoryProvider {
  readonly name: string;
  ensureNamespace(spec: MemoryNamespaceSpec): Promise<{ namespace: string }>;
  deleteNamespace(namespace: string): Promise<void>;
}

export class SupermemoryProvider implements MemoryProvider {
  readonly name = "supermemory";
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
  ) {}

  async ensureNamespace(spec: MemoryNamespaceSpec): Promise<{ namespace: string }> {
    // Supermemory namespaces are created lazily on first write. When an API key
    // is configured we could pre-register; for the MVP we simply echo back the
    // namespace so provisioning can carry it into the tenant config.
    return { namespace: spec.namespace };
  }

  async deleteNamespace(_namespace: string): Promise<void> {
    // No-op placeholder for MVP; real teardown wired in production.
  }
}
