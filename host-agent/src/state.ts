import { readFileSync, writeFileSync, existsSync } from "node:fs";

export interface AgentState {
  hostId?: string;
  agentKey?: string;
  approved?: boolean;
  registeredAt?: string;
}

export function loadState(path: string): AgentState {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AgentState;
  } catch {
    return {};
  }
}

export function saveState(path: string, state: AgentState): void {
  writeFileSync(path, JSON.stringify(state, null, 2), { mode: 0o600 });
}
