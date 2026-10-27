import { spawnSync } from "node:child_process";
import type { FullConfig } from "@playwright/test";
import pg from "pg";
import { testDatabaseUrl } from "./test-database";

// Runs once before the scenarios: empty every table of the test database, then seed the demo data.
// Migrations are not run here: `pnpm test` (Vitest) migrates simpul_test; if tables are missing, run it once.
export default async function globalSetup(config: FullConfig) {
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

  await warmUp(config.projects[0]?.use.baseURL);
}

// The web server is already running here. `next dev` compiles a route on its first request, which made the
// first scenario time out; request the pages and the login endpoint once, so the scenarios hit compiled code.
async function warmUp(baseURL: string | undefined) {
  if (!baseURL) return;
  for (const path of ["/login", "/api/me", "/dashboard", "/stock", "/transfers/new"]) {
    await fetch(`${baseURL}${path}`, { redirect: "manual" }).catch(() => {});
  }
}
