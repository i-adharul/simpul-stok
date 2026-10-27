import { spawnSync } from "node:child_process";
import pg from "pg";
import { testDatabaseUrl } from "./test-database";

// Runs once before the scenarios: empty every table of the test database, then seed the demo data.
// Migrations are not run here: `pnpm test` (Vitest) migrates simpul_test; if tables are missing, run it once.
export default async function globalSetup() {
  const client = new pg.Client({ connectionString: testDatabaseUrl });
  try {
    await client.connect();
    const tables = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
    );
    if (tables.rows.length === 0) {
      throw new Error("The test database has no tables. Run `pnpm test` once to migrate it.");
    }
    const names = tables.rows.map((row) => `"${row.tablename}"`).join(", ");
    await client.query(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
  } finally {
    await client.end().catch(() => {});
  }

  // The seed reads DATABASE_URL: point it at the test database, which wins over .env.
  const seed = spawnSync("pnpm", ["exec", "tsx", "prisma/seed-demo.ts"], {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl, DEMO_PASSWORD: "" },
    encoding: "utf8",
  });
  if (seed.status !== 0) {
    throw new Error(`Demo seed failed:\n${seed.stdout}${seed.stderr}`);
  }
}
