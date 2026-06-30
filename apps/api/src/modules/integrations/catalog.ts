// Connector catalog — declarative definitions the UI renders config forms from.
// Adding a connector here surfaces it in the Integrations marketplace with zero
// UI changes. Each `fields` entry describes one config input.

export interface ConnectorField {
  key: string;
  label: string;
  type: "text" | "password" | "url" | "boolean" | "select";
  required?: boolean;
  options?: string[];
  placeholder?: string;
  secret?: boolean; // stored as a secret reference, not in config_json
}

export interface ConnectorDef {
  kind: string;
  name: string;
  category: "runtime" | "observability" | "cloud" | "comms" | "psa" | "ai" | "other";
  description: string;
  capabilities: ("datasource" | "notifications" | "actions")[];
  fields: ConnectorField[];
}

export const CONNECTOR_CATALOG: ConnectorDef[] = [
  { kind: "swarmclaw", name: "SwarmClaw", category: "runtime", description: "Tenant agent runtime — pull agent/conversation status and ship logs.", capabilities: ["datasource"], fields: [{ key: "base_url", label: "Runtime URL", type: "url", required: true }, { key: "api_key", label: "API key", type: "password", secret: true }, { key: "log_dir", label: "Log directory", type: "text", placeholder: "/var/lib/swarmclaw/logs" }] },
  { kind: "openclaw", name: "OpenClaw", category: "runtime", description: "OpenClaw runtime — status polling + log folder shipping.", capabilities: ["datasource"], fields: [{ key: "base_url", label: "Runtime URL", type: "url" }, { key: "api_key", label: "API key", type: "password", secret: true }, { key: "log_dir", label: "Log directory", type: "text", placeholder: "/var/log/openclaw" }] },
  { kind: "grafana", name: "Grafana", category: "observability", description: "Link dashboards / forward panels.", capabilities: ["datasource"], fields: [{ key: "base_url", label: "Grafana URL", type: "url", required: true }, { key: "api_token", label: "API token", type: "password", secret: true }] },
  { kind: "prometheus", name: "Prometheus", category: "observability", description: "Scrape/query an external Prometheus.", capabilities: ["datasource"], fields: [{ key: "base_url", label: "Prometheus URL", type: "url", required: true }] },
  { kind: "loki", name: "Loki", category: "observability", description: "Query logs from a Loki instance.", capabilities: ["datasource"], fields: [{ key: "base_url", label: "Loki URL", type: "url", required: true }] },
  { kind: "uptime-kuma", name: "Uptime Kuma", category: "observability", description: "Pull monitor status.", capabilities: ["datasource"], fields: [{ key: "base_url", label: "Kuma URL", type: "url", required: true }, { key: "api_key", label: "API key", type: "password", secret: true }] },
  { kind: "hetzner", name: "Hetzner", category: "cloud", description: "Cloud/dedicated server inventory + metrics.", capabilities: ["datasource", "actions"], fields: [{ key: "api_token", label: "API token", type: "password", required: true, secret: true }] },
  { kind: "cloudflare", name: "Cloudflare", category: "cloud", description: "DNS, tunnels, analytics.", capabilities: ["datasource", "actions"], fields: [{ key: "api_token", label: "API token", type: "password", required: true, secret: true }, { key: "account_id", label: "Account ID", type: "text" }] },
  { kind: "tailscale", name: "Tailscale", category: "cloud", description: "Tailnet device status.", capabilities: ["datasource"], fields: [{ key: "api_key", label: "API key", type: "password", required: true, secret: true }, { key: "tailnet", label: "Tailnet", type: "text" }] },
  { kind: "discord", name: "Discord", category: "comms", description: "Alert notifications.", capabilities: ["notifications"], fields: [{ key: "webhook_url", label: "Webhook URL", type: "url", required: true, secret: true }] },
  { kind: "microsoft365", name: "Microsoft 365 / Teams", category: "comms", description: "Teams alert notifications.", capabilities: ["notifications"], fields: [{ key: "webhook_url", label: "Teams webhook", type: "url", required: true, secret: true }] },
  { kind: "github", name: "GitHub", category: "other", description: "Repo/CI status + issue creation.", capabilities: ["datasource", "actions"], fields: [{ key: "token", label: "Token", type: "password", required: true, secret: true }, { key: "org", label: "Org/owner", type: "text" }] },
  { kind: "halopsa", name: "HaloPSA", category: "psa", description: "Ticketing + asset sync.", capabilities: ["datasource", "actions"], fields: [{ key: "base_url", label: "Halo URL", type: "url", required: true }, { key: "client_id", label: "Client ID", type: "text" }, { key: "client_secret", label: "Client secret", type: "password", secret: true }] },
  { kind: "hudu", name: "Hudu", category: "psa", description: "Documentation sync.", capabilities: ["datasource"], fields: [{ key: "base_url", label: "Hudu URL", type: "url", required: true }, { key: "api_key", label: "API key", type: "password", secret: true }] },
  { kind: "quickbooks", name: "QuickBooks", category: "other", description: "Billing export.", capabilities: ["datasource"], fields: [{ key: "realm_id", label: "Realm ID", type: "text", required: true }, { key: "access_token", label: "Access token", type: "password", secret: true }] },
];
