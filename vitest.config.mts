import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Vitest does not load .env by itself; load it so src/lib/env.ts can parse it.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

export default defineConfig({
  // Same "@/" alias as tsconfig, so tests can import route modules.
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    // Non-secret stand-in so tests never depend on (or leak) the real secret from .env.
    // DATABASE_URL is pointed at the test database so route modules (which build their own client from
    // it) and the fixtures (TEST_DATABASE_URL) use the same database. global-setup.ts fails the whole
    // run if they ever differ. .env is not touched.
    env: {
      SESSION_SECRET: "test-only-session-secret-0123456789abcdef",
      ...(process.env.TEST_DATABASE_URL ? { DATABASE_URL: process.env.TEST_DATABASE_URL } : {}),
    },
    include: ["src/**/*.test.ts"],
    globalSetup: ["./src/test/global-setup.ts"],
    // Database tests truncate shared tables, so test files must not run at the same time.
    fileParallelism: false,
  },
});
