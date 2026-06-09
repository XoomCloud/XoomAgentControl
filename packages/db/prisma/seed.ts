import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@xoomagent.local";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "changeme123!";

  // --- Bootstrap platform owner ---
  const passwordHash = await bcrypt.hash(adminPassword, 12);
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: "Platform Owner",
      passwordHash,
      role: "platform_owner",
    },
  });
  console.log(`✔ admin user: ${admin.email}`);

  // --- Seed MCP registry with common servers ---
  const mcpServers = [
    { name: "filesystem", description: "Sandboxed filesystem access inside the tenant VM", transport: "stdio" as const, riskLevel: "low" as const, approvalRequired: false },
    { name: "microsoft-365", description: "Microsoft 365 (Graph) — mail, calendar, files", transport: "http" as const, riskLevel: "high" as const, approvalRequired: true, authType: "oauth2" },
    { name: "google-workspace", description: "Google Workspace — Gmail, Drive, Calendar", transport: "http" as const, riskLevel: "high" as const, approvalRequired: true, authType: "oauth2" },
    { name: "slack", description: "Slack messaging and channel access", transport: "http" as const, riskLevel: "medium" as const, approvalRequired: true, authType: "oauth2" },
    { name: "xero", description: "Xero accounting", transport: "http" as const, riskLevel: "high" as const, approvalRequired: true, authType: "oauth2" },
    { name: "myob", description: "MYOB accounting", transport: "http" as const, riskLevel: "high" as const, approvalRequired: true, authType: "oauth2" },
    { name: "salesforce", description: "Salesforce CRM", transport: "http" as const, riskLevel: "high" as const, approvalRequired: true, authType: "oauth2" },
    { name: "sql-database", description: "Read/write access to a provisioned SQL database", transport: "stdio" as const, riskLevel: "high" as const, approvalRequired: true, authType: "connection_string" },
    { name: "custom-http-api", description: "Generic HTTP API bridge", transport: "http" as const, riskLevel: "medium" as const, approvalRequired: true, authType: "api_key" },
  ];

  for (const s of mcpServers) {
    await prisma.mcpServer.upsert({
      where: { name: s.name },
      update: {},
      create: s,
    });
  }
  console.log(`✔ seeded ${mcpServers.length} MCP servers`);

  // --- Seed a starter agent template ---
  await prisma.agentTemplate.upsert({
    where: { name: "General Assistant" },
    update: {},
    create: {
      name: "General Assistant",
      description: "A baseline single-agent pack: general assistant with filesystem + memory.",
      defaultSystemPrompt: "You are a helpful operations assistant for this tenant.",
      skillsJson: ["summarise", "research", "draft-email"],
      schedulesJson: [],
      mcpToolsJson: ["filesystem"],
      memoryPolicyJson: { provider: "supermemory", retentionDays: 90 },
      llmPolicyJson: { defaultModel: "gpt-4o-mini", fallbackModels: ["claude-haiku-4-5"] },
    },
  });
  console.log("✔ seeded starter agent template");

  // --- Platform settings defaults ---
  await prisma.platformSetting.upsert({
    where: { key: "platform" },
    update: {},
    create: {
      key: "platform",
      valueJson: {
        platformName: "XoomAgent Control Platform",
        defaultRuntime: "swarmclaw",
        heartbeatIntervalSeconds: 30,
        offlineThresholdSeconds: 90,
      },
    },
  });
  console.log("✔ seeded platform settings");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
