import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { env } from "../src/lib/env";
import { assertSeedTarget, seedBase } from "../src/modules/platform/seed";

// Entry point of `pnpm prisma db seed` (prisma.config.ts, migrations.seed).
// The target is checked before a client exists, so a wrong DATABASE_URL never gets a connection.
async function main() {
  assertSeedTarget(env.DATABASE_URL, env.NODE_ENV, env.SEED_ALLOW_REMOTE);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });
  try {
    await seedBase(prisma);
    console.log("Seed done: plans, demo organization, demo users.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  // Print the message only: it never holds the URL, and a stack adds nothing for a refusal.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
