import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Why this file reads process.env directly (exception to CLAUDE.md rule 5): the Prisma CLI runs
// outside the app, and importing src/lib/env.ts would demand every app variable just to run
// `prisma generate`. Prisma 7 does not load .env by itself, so we do it here when the file exists.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL },
});
