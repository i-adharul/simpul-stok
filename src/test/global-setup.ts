import { spawnSync } from "node:child_process";
import pg from "pg";
import { env } from "../lib/env";
import { assertTestDatabaseUrl } from "./test-database";

// Vitest 5.0.5 crashes while printing the stack of an error thrown from globalSetup and hides the
// message, so every failure is printed with console.error first and then thrown.
function fail(message: string, cause?: unknown): never {
  console.error(message);
  throw new Error(message, { cause });
}

function checkDatabaseUrl(url: string | undefined): string {
  try {
    return assertTestDatabaseUrl(url);
  } catch (error) {
    return fail((error as Error).message, error);
  }
}

// Keeps CLI output free of the host and the connection string before it is printed.
function redact(output: string): string {
  return output
    .split("\n")
    .filter((line) => !/Datasource|postgres(ql)?:\/\//i.test(line))
    .join("\n");
}

// Runs once before all tests: prove the test database is reachable, then bring it up to date.
export default async function setup() {
  const testDatabaseUrl = checkDatabaseUrl(env.TEST_DATABASE_URL);

  const client = new pg.Client({ connectionString: testDatabaseUrl });
  try {
    await client.connect();
  } catch (error) {
    // Only the error code (for example ECONNREFUSED) is printed: the pg message contains the host.
    const code = (error as { code?: string }).code ?? "unknown error";
    fail(
      `Cannot connect to the test database (${code}). Start it with \`docker compose up -d\`. ` +
        "If it is running, check that TEST_DATABASE_URL is correct and that nothing else uses its port (Docker maps 5433).",
      error,
    );
  } finally {
    await client.end().catch(() => {});
  }

  // The Prisma CLI reads DATABASE_URL (prisma.config.ts), so point it at the test database for this
  // process and its children. A variable that is already set wins over .env, which may name the
  // development database. Tests then never migrate the development database.
  process.env.DATABASE_URL = testDatabaseUrl;

  // Do not trust our own assignment: ask the CLI which database it resolved, and check that name.
  const databaseName = databaseNameUsedByCli();
  checkDatabaseUrl(`postgresql://placeholder/${databaseName}`);

  const deploy = runPrisma(["migrate", "deploy"]);
  if (deploy.status !== 0) {
    fail(`prisma migrate deploy failed on "${databaseName}":\n${redact(deploy.output)}`);
  }
  console.log(`Test database migrated: ${databaseName}`); // name only, never host or credentials
}

function runPrisma(args: string[]) {
  const result = spawnSync("pnpm", ["prisma", ...args], { encoding: "utf8" });
  const output = `${result.stdout}${result.stderr}`;
  return { status: result.status, output };
}

// `migrate status` is read-only and prints the datasource it connected to (exit code is ignored:
// it is non-zero while migrations are pending).
function databaseNameUsedByCli(): string {
  const { output } = runPrisma(["migrate", "status"]);
  const match = output.match(/PostgreSQL database "([^"]+)"/);
  if (!match) {
    fail(`Could not tell which database the Prisma CLI uses:\n${redact(output)}`);
  }
  return match[1];
}
