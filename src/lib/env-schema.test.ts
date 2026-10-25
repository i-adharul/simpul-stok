import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseEnv, SESSION_SECRET_EXAMPLE } from "./env-schema";

const validEnv = {
  DATABASE_URL: "postgresql://simpul:simpul@localhost:5432/simpul_dev",
  SESSION_SECRET: "test-only-session-secret-0123456789abcdef",
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

  describe("SESSION_SECRET", () => {
    it("is required", () => {
      expect(() => parseEnv({ DATABASE_URL: validEnv.DATABASE_URL })).toThrow(/SESSION_SECRET/);
    });

    it("rejects a value shorter than 32 characters", () => {
      expect(() => parseEnv({ ...validEnv, SESSION_SECRET: "a".repeat(31) })).toThrow(
        /SESSION_SECRET/,
      );
      expect(parseEnv({ ...validEnv, SESSION_SECRET: "a".repeat(32) }).SESSION_SECRET).toHaveLength(
        32,
      );
    });

    it("rejects the placeholder from .env.example, so a copied file cannot sign sessions", () => {
      const example = readFileSync(".env.example", "utf8").match(/^SESSION_SECRET=(.*)$/m)?.[1];
      expect(example).toBe(SESSION_SECRET_EXAMPLE);
      expect(example!.length).toBeGreaterThanOrEqual(32); // rejected for being the example, not for length
      expect(() => parseEnv({ ...validEnv, SESSION_SECRET: example })).toThrow(/SESSION_SECRET/);
    });

    it("never prints the value in the error message", () => {
      const secrets = ["short-secret", SESSION_SECRET_EXAMPLE];
      for (const secret of secrets) {
        let message = "";
        try {
          parseEnv({ ...validEnv, SESSION_SECRET: secret });
        } catch (error) {
          message = (error as Error).message;
        }
        expect(message).toMatch(/SESSION_SECRET/);
        expect(message).not.toContain(secret);
      }
    });
  });
});
