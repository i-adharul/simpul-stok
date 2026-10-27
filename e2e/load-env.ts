import { existsSync } from "node:fs";

// Playwright does not load .env by itself (same reason as vitest.config.mts). This module must be
// imported BEFORE anything that imports src/lib/env, which parses process.env once.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}
