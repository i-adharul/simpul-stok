import { describe, expect, it } from "vitest";
import { assertSameTestDatabase, assertTestDatabaseUrl } from "./test-database";
import { assertLocalTestDatabaseUrl } from "./test-database-url";

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

describe("assertSameTestDatabase", () => {
  const test = "postgresql://simpul:simpul@localhost:5433/simpul_test";

  it("accepts the same host, port and database (credentials may differ)", () => {
    expect(() => assertSameTestDatabase(test, test)).not.toThrow();
    expect(() =>
      assertSameTestDatabase(
        "postgresql://other:pw@localhost:5433/simpul_test?sslmode=disable",
        test,
      ),
    ).not.toThrow();
  });

  it("rejects DATABASE_URL pointing at the development database", () => {
    expect(() =>
      assertSameTestDatabase("postgresql://simpul:simpul@localhost:5433/simpul_dev", test),
    ).toThrow(/must be the same database as TEST_DATABASE_URL/);
  });

  it("rejects a different host or port with the same database name", () => {
    expect(() =>
      assertSameTestDatabase("postgresql://simpul:simpul@db.example.com:5433/simpul_test", test),
    ).toThrow(/same database/);
    expect(() =>
      assertSameTestDatabase("postgresql://simpul:simpul@localhost:5432/simpul_test", test),
    ).toThrow(/same database/);
  });

  it("rejects when both name a database that does not end with _test", () => {
    const dev = "postgresql://simpul:simpul@localhost:5433/simpul_dev";
    expect(() => assertSameTestDatabase(dev, dev)).toThrow(/must end with "_test"/);
  });

  it("rejects a missing DATABASE_URL and never prints the connection string", () => {
    expect(() => assertSameTestDatabase(undefined, test)).toThrow(/DATABASE_URL is not set/);
    try {
      assertSameTestDatabase("postgresql://simpul:secretpw@localhost:5433/simpul_dev", test);
    } catch (error) {
      expect((error as Error).message).not.toMatch(/secretpw/);
    }
  });
});

describe("assertLocalTestDatabaseUrl", () => {
  it("accepts a local database ending with _test", () => {
    const url = "postgresql://simpul:simpul@localhost:5433/simpul_test";
    expect(assertLocalTestDatabaseUrl(url)).toBe(url);
  });

  it("refuses a remote host even when the name ends with _test", () => {
    expect(() =>
      assertLocalTestDatabaseUrl("postgresql://simpul:pw@db.example.com:5432/simpul_test"),
    ).toThrow(/on this machine/);
  });

  it("still refuses a local database with a wrong name", () => {
    expect(() =>
      assertLocalTestDatabaseUrl("postgresql://simpul:simpul@localhost:5433/simpul_dev"),
    ).toThrow(/must end with "_test"/);
  });
});
