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

// Route modules open their own connection from DATABASE_URL, while fixtures use TEST_DATABASE_URL.
// If they differed, a harness would read one database and write another and pass for the wrong
// reason. Host, port and database name are compared; the message never contains the URL.
export function assertSameTestDatabase(
  databaseUrl: string | undefined,
  testDatabaseUrl: string | undefined,
): void {
  if (!databaseUrl) throw new Error("DATABASE_URL is not set for the test workers.");
  const test = new URL(assertTestDatabaseUrl(testDatabaseUrl));
  const actual = new URL(databaseUrl);
  const where = (u: URL) => `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  if (where(actual) !== where(test)) {
    throw new Error(
      `DATABASE_URL must be the same database as TEST_DATABASE_URL under Vitest ` +
        `(got ${where(actual)}, expected ${where(test)}).`,
    );
  }
  assertTestDatabaseUrl(databaseUrl);
}

// `max` is the pool size. A concurrency test that starts N transactions waiting on one row lock needs
// a pool of at least N, otherwise the waiting ones starve the pool and fail on maxWait, not on the rule.
export function createTestPrisma(
  testDatabaseUrl: string,
  options: { max?: number } = {},
): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: assertTestDatabaseUrl(testDatabaseUrl),
      max: options.max,
    }),
  });
}
