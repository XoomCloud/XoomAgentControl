#!/usr/bin/env node
import { loadAgentConfig } from "./config.js";
import { HostAgent } from "./agent.js";
import { runPreflight } from "./preflight.js";

async function main() {
  const command = process.argv[2] ?? "run";
  const cfg = loadAgentConfig();

  switch (command) {
    case "run": {
      const agent = new HostAgent(cfg);
      await agent.run();
      // Keep the process alive; the run loop owns the intervals.
      break;
    }
    case "preflight": {
      const { checks, allOk } = await runPreflight(cfg);
      console.log("\nXoomAgent host preflight\n========================");
      for (const c of checks) {
        console.log(`${c.ok ? "✔" : "✗"} ${c.name.padEnd(24)} ${c.detail}`);
      }
      console.log(`\nResult: ${allOk ? "READY" : "NOT READY"}\n`);
      process.exit(allOk ? 0 : 1);
      break;
    }
    case "register": {
      const agent = new HostAgent(cfg);
      await agent.ensureRegistered();
      process.exit(0);
      break;
    }
    default:
      console.error(`Unknown command: ${command}. Use: run | preflight | register`);
      process.exit(1);
  }
}

void main();
