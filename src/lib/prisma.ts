import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/lib/env";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Prisma 7 requires a driver adapter. The generated client lives outside
 * node_modules, so it is imported from src/generated rather than @prisma/client.
 *
 * Cached on globalThis so Next's dev-mode hot reload does not open a new pool on
 * every edit.
 */
const globalForPrisma = globalThis as unknown as { promptguardPrisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.databaseUrl });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.promptguardPrisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.promptguardPrisma = prisma;
}
