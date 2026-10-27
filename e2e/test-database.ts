import "./load-env";
import { env } from "../src/lib/env";
import { assertTestDatabaseUrl } from "../src/test/test-database-url";

// The e2e run resets and seeds this database and points the app at it, so a wrong name must stop the
// run before anything starts. Reuses the guard of the Vitest setup.
export const testDatabaseUrl = assertTestDatabaseUrl(env.TEST_DATABASE_URL);
