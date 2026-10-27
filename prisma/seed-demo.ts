import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { env } from "../src/lib/env";
import { assertSeedTarget, resolveDemoPassword } from "../src/modules/platform/seed";
import { seedDemo } from "./demo-seed";

// Entry point of `pnpm seed:demo`. Same guard as seed.ts, plus: on a remote database the committed
// local passwords are never used (DEMO_PASSWORD is required) and no platform admin is created.
// Both checks run before a client exists, so a wrong target never gets a connection.
async function main() {
  assertSeedTarget(env.DATABASE_URL, env.NODE_ENV, env.SEED_ALLOW_REMOTE);
  const password = resolveDemoPassword(env.DATABASE_URL, env.DEMO_PASSWORD);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });
  try {
    await seedDemo(prisma, { password });
    console.log("Demo seed done: warehouses, products, stock operations, demo accounts.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  // Message only: it never holds the URL or a password.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
