import { existsSync } from "node:fs";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

// Load a .env file if present (repo root or cwd). Real deployments inject env
// directly; this is a dev convenience.
for (const candidate of [".env", "../../.env", "../.env"]) {
  if (existsSync(candidate)) {
    try {
      (process as NodeJS.Process & { loadEnvFile?: (p: string) => void }).loadEnvFile?.(candidate);
      break;
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  const config = loadConfig();
  const app = await buildApp();
  try {
    await app.listen({ host: config.API_HOST, port: config.API_PORT });
    app.log.info(`XoomAgent Control API listening on ${config.API_PUBLIC_URL} (docs at /docs)`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
