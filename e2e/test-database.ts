import "./load-env";
import { env } from "../src/lib/env";
import { assertLocalTestDatabaseUrl } from "../src/test/test-database-url";

// The e2e run resets and seeds this database and points the app at it, so a wrong name must stop the
// run before anything starts. Reuses the name guard of the Vitest setup and adds a local-host check.
export const testDatabaseUrl = assertLocalTestDatabaseUrl(env.TEST_DATABASE_URL);
