import path from "node:path";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

// Rule 3 is also enforced by lint (story E2-04): only an allowlist of files may use the plain
// Prisma client or raw SQL. These tests lint small snippets as if they lived at a given path.

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: path.resolve(import.meta.dirname, "..") });
});

async function rulesFor(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((m) => m.ruleId ?? `fatal: ${m.message}`);
}

const IMPORT_DB_ALIAS = `import { db } from "@/lib/db";\nexport const x = db;\n`;
const IMPORT_DB_RELATIVE = `import { db } from "../../lib/db";\nexport const x = db;\n`;
const IMPORT_CLIENT_TYPE = `import type { PrismaClient } from "../../generated/prisma/client";\nexport type X = PrismaClient;\n`;
const IMPORT_CLIENT_VALUE = `import { PrismaClient } from "@/generated/prisma/client";\nexport const x = PrismaClient;\n`;
const IMPORT_MODEL_TYPE = `import type { Warehouse, Prisma } from "../../generated/prisma/client";\nexport type X = [Warehouse, Prisma.WarehouseCreateArgs];\n`;
const RAW_TAGGED = "export const f = (c: any) => c.$queryRaw`SELECT 1`;\n";
const RAW_CALL = `export const f = (c: any) => c.$executeRawUnsafe("DELETE FROM x");\n`;

describe("plain Prisma client import", () => {
  it.each([
    ["a service", "src/modules/stock/warehouse-service.ts"],
    ["a stock route handler", "src/app/api/warehouses/route.ts"],
    ["a platform service that is not on the allowlist", "src/modules/platform/some-service.ts"],
    ["a component", "src/components/x.tsx"],
  ])("fails in %s", async (_name, filePath) => {
    for (const code of [IMPORT_DB_ALIAS, IMPORT_DB_RELATIVE]) {
      expect(await rulesFor(code, filePath)).toContain("no-restricted-imports");
    }
  });

  it.each([
    "src/lib/db.ts",
    "src/modules/platform/tenant-client.ts",
    "src/modules/platform/tenant-route.ts",
    "src/modules/platform/server-session.ts",
    "src/app/api/auth/login/route.ts",
    "src/app/api/me/route.ts",
    "src/app/api/me/password/route.ts",
    "src/app/api/health/route.ts",
    "prisma/seed.ts",
    "src/modules/platform/seed.ts",
    "src/modules/platform/warehouse.test.ts",
    "src/test/test-database.ts",
  ])("passes in %s", async (filePath) => {
    expect(await rulesFor(IMPORT_DB_ALIAS, filePath)).not.toContain("no-restricted-imports");
  });
});

describe("api/me allowlist", () => {
  it("fails for a new route under /api/me until it is added with a reason", async () => {
    for (const file of [
      "src/app/api/me/sessions/route.ts",
      "src/app/api/me/preferences/route.ts",
      "src/app/api/me/password/extra.ts",
    ]) {
      expect(await rulesFor(IMPORT_DB_ALIAS, file), file).toContain("no-restricted-imports");
    }
  });
});

describe("PrismaClient type import", () => {
  it("fails in a service, as a type and as a value", async () => {
    const file = "src/modules/stock/warehouse-service.ts";
    expect(await rulesFor(IMPORT_CLIENT_TYPE, file)).toContain("no-restricted-imports");
    expect(await rulesFor(IMPORT_CLIENT_VALUE, file)).toContain("no-restricted-imports");
  });

  it("passes in the auth modules and the tenant client", async () => {
    for (const file of [
      "src/modules/platform/current-user.ts",
      "src/modules/platform/request-context.ts",
      "src/modules/platform/tenant-client.ts",
    ]) {
      expect(await rulesFor(IMPORT_CLIENT_TYPE, file)).not.toContain("no-restricted-imports");
    }
  });

  it("still allows model and namespace types in a service", async () => {
    expect(
      await rulesFor(IMPORT_MODEL_TYPE, "src/modules/stock/warehouse-service.ts"),
    ).not.toContain("no-restricted-imports");
  });
});

describe("raw SQL", () => {
  it.each([RAW_TAGGED, RAW_CALL])("fails in a service", async (code) => {
    expect(await rulesFor(code, "src/modules/stock/report-service.ts")).toContain(
      "no-restricted-syntax",
    );
  });

  it("fails in an auth module, which may hold the plain client but not write raw SQL", async () => {
    expect(await rulesFor(RAW_TAGGED, "src/modules/platform/current-user.ts")).toContain(
      "no-restricted-syntax",
    );
  });

  it.each(["src/lib/db.ts", "src/modules/platform/schema.test.ts", "src/test/helper.ts"])(
    "passes in %s",
    async (filePath) => {
      expect(await rulesFor(RAW_TAGGED, filePath)).not.toContain("no-restricted-syntax");
    },
  );
});
