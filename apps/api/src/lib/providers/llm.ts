// LLM gateway provider abstraction. Default implementation targets LiteLLM's
// admin API (virtual keys, budgets, spend). Provider-specific code stays behind
// this interface so OpenRouter/others can be added without touching callers.

export interface VirtualKeySpec {
  tenantSlug: string;
  modelAllowlist?: string[];
  maxBudgetUsd?: number;
  rpmLimit?: number;
}

export interface VirtualKeyResult {
  key: string;
  keyName: string;
}

export interface SpendInfo {
  spendUsd: number;
  maxBudgetUsd?: number;
}

export interface LlmGateway {
  readonly name: string;
  createVirtualKey(spec: VirtualKeySpec): Promise<VirtualKeyResult>;
  updateVirtualKey(keyName: string, spec: Partial<VirtualKeySpec>): Promise<void>;
  getSpend(keyName: string): Promise<SpendInfo | null>;
  deleteVirtualKey(keyName: string): Promise<void>;
}

export class LiteLlmGateway implements LlmGateway {
  readonly name = "litellm";
  constructor(
    private readonly baseUrl: string,
    private readonly adminKey?: string,
  ) {}

  private get configured(): boolean {
    return Boolean(this.adminKey);
  }

  private async call(path: string, method: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.adminKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`LiteLLM ${method} ${path} failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  async createVirtualKey(spec: VirtualKeySpec): Promise<VirtualKeyResult> {
    const keyName = `tenant-${spec.tenantSlug}`;
    if (!this.configured) {
      // Unconfigured (MVP/dev): return a deterministic placeholder so the rest
      // of the provisioning flow proceeds. The real key is minted in prod.
      return { key: `sk-placeholder-${spec.tenantSlug}`, keyName };
    }
    const out = (await this.call("/key/generate", "POST", {
      key_alias: keyName,
      models: spec.modelAllowlist ?? [],
      max_budget: spec.maxBudgetUsd,
      rpm_limit: spec.rpmLimit,
      metadata: { tenant: spec.tenantSlug },
    })) as { key: string };
    return { key: out.key, keyName };
  }

  async updateVirtualKey(keyName: string, spec: Partial<VirtualKeySpec>): Promise<void> {
    if (!this.configured) return;
    await this.call("/key/update", "POST", {
      key_alias: keyName,
      models: spec.modelAllowlist,
      max_budget: spec.maxBudgetUsd,
      rpm_limit: spec.rpmLimit,
    });
  }

  async getSpend(keyName: string): Promise<SpendInfo | null> {
    if (!this.configured) return null;
    try {
      const out = (await this.call(`/key/info?key_alias=${encodeURIComponent(keyName)}`, "GET")) as {
        info?: { spend?: number; max_budget?: number };
      };
      return { spendUsd: out.info?.spend ?? 0, maxBudgetUsd: out.info?.max_budget };
    } catch {
      return null;
    }
  }

  async deleteVirtualKey(keyName: string): Promise<void> {
    if (!this.configured) return;
    await this.call("/key/delete", "POST", { key_aliases: [keyName] });
  }
}
