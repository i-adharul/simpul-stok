import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

// Tests truncate tables. This guard is the only thing standing between a typo in
// TEST_DATABASE_URL and an empty development database, so it checks the name itself.
// (It must not compare with DATABASE_URL: in CI both point to the same test database.)
export function assertTestDatabaseUrl(url: string | undefined): string {
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set. Add it to .env (see .env.example).");
  }
  const databaseName = new URL(url).pathname.replace(/^\//, "");
  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to run tests: TEST_DATABASE_URL points to "${databaseName}", ` +
        `but the database name must end with "_test".`,
    );
  }
  return url;
}

export function createTestPrisma(testDatabaseUrl: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: assertTestDatabaseUrl(testDatabaseUrl) }),
  });
}
