import { describe, expect, it } from "vitest";
import { assertTestDatabaseUrl } from "./test-database";

describe("assertTestDatabaseUrl", () => {
  it("accepts a database whose name ends with _test", () => {
    const url = "postgresql://simpul:simpul@localhost:5432/simpul_test";
    expect(assertTestDatabaseUrl(url)).toBe(url);
  });

  it("rejects the development database", () => {
    expect(() =>
      assertTestDatabaseUrl("postgresql://simpul:simpul@localhost:5432/simpul_dev"),
    ).toThrow(/must end with "_test"/);
  });

  it("rejects a missing URL", () => {
    expect(() => assertTestDatabaseUrl(undefined)).toThrow(/TEST_DATABASE_URL is not set/);
  });
});
