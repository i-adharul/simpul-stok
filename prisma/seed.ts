import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { env } from "../src/lib/env";
import { seedBase } from "../src/modules/platform/seed";

// Entry point of `pnpm prisma db seed` (prisma.config.ts, migrations.seed).
// The demo passwords are public in the repository, so this must never reach a real database.
async function main() {
  if (env.NODE_ENV === "production") {
    throw new Error("Refusing to seed demo accounts with NODE_ENV=production.");
  }
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
  console.error(error);
  process.exit(1);
});
