import { describe, expect, it } from "vitest";
import { parseEnv } from "./env-schema";

const validEnv = {
  DATABASE_URL: "postgresql://simpul:simpul@localhost:5432/simpul_dev",
};

describe("parseEnv", () => {
  it("accepts a valid configuration and applies defaults", () => {
    const env = parseEnv(validEnv);

    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(env.NODE_ENV).toBe("development");
    expect(env.TEST_DATABASE_URL).toBeUndefined();
  });

  it("treats VERCEL_GIT_COMMIT_SHA as optional", () => {
    expect(parseEnv(validEnv).VERCEL_GIT_COMMIT_SHA).toBeUndefined();
    expect(
      parseEnv({ ...validEnv, VERCEL_GIT_COMMIT_SHA: "abc1234def" }).VERCEL_GIT_COMMIT_SHA,
    ).toBe("abc1234def");
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it("rejects a DATABASE_URL that is not a PostgreSQL URL", () => {
    expect(() => parseEnv({ DATABASE_URL: "mysql://localhost/db" })).toThrow(/PostgreSQL/);
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(() => parseEnv({ ...validEnv, NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });
});
