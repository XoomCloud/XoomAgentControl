import type {
  RegisterHostRequest,
  RegisterHostResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  NextCommandResponse,
  CommandResultRequest,
} from "@xoom/shared-types";

/** Thin client over the control-plane host-agent API. All calls are outbound. */
export class ControlPlaneClient {
  constructor(
    private readonly baseUrl: string,
    private hostId?: string,
    private agentKey?: string,
  ) {}

  setCredentials(hostId: string, agentKey: string) {
    this.hostId = hostId;
    this.agentKey = agentKey;
  }

  private async req<T>(path: string, init: RequestInit & { auth?: "host" | "register" } = {}): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json", ...(init.headers as Record<string, string>) };
    if (init.auth === "host" && this.agentKey) headers.authorization = `Bearer ${this.agentKey}`;
    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    const text = await res.text();
    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${text}`);
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }

  registerWithToken(body: RegisterHostRequest, token: string): Promise<RegisterHostResponse> {
    return this.req<RegisterHostResponse>("/api/hosts/register", {
      method: "POST",
      headers: { "x-registration-token": token },
      body: JSON.stringify(body),
    });
  }

  heartbeat(body: HeartbeatRequest): Promise<HeartbeatResponse> {
    return this.req<HeartbeatResponse>(`/api/hosts/${this.hostId}/heartbeat`, {
      method: "POST",
      auth: "host",
      body: JSON.stringify(body),
    });
  }

  nextCommand(): Promise<NextCommandResponse> {
    return this.req<NextCommandResponse>(`/api/hosts/${this.hostId}/commands/next`, { auth: "host" });
  }

  reportResult(commandId: string, body: CommandResultRequest): Promise<{ ok: boolean }> {
    return this.req(`/api/hosts/${this.hostId}/commands/${commandId}/result`, {
      method: "POST",
      auth: "host",
      body: JSON.stringify(body),
    });
  }
}
