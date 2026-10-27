import { describe, expect, it } from "vitest";
import {
  SEED_ALLOW_REMOTE_VALUE,
  assertSeedTarget,
  isLocalDatabase,
  resolveDemoPassword,
} from "./seed";

const local = (host: string) => `postgresql://simpul:secret-pw@${host}:5433/simpul_dev`;
const neon =
  "postgresql://neon_user:neon-secret-pw@ep-example-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

describe("assertSeedTarget", () => {
  it.each(["localhost", "127.0.0.1", "[::1]"])("accepts the local host %s", (host) => {
    expect(() => assertSeedTarget(local(host), "development", undefined)).not.toThrow();
  });

  it("rejects a remote host and names only the host", () => {
    expect(() => assertSeedTarget(neon, "development", undefined)).toThrow(
      /ep-example-123\.ap-southeast-1\.aws\.neon\.tech/,
    );
  });

  it("explains why and names the deliberate way", () => {
    expect(() => assertSeedTarget(neon, "development", undefined)).toThrow(/demo accounts/);
    expect(() => assertSeedTarget(neon, "development", undefined)).toThrow(/SEED_ALLOW_REMOTE/);
  });

  it("never puts the user, password, path or query in the message", () => {
    for (const url of [
      neon,
      local("localhost"),
      "postgresql://u:topsecret@db.example.invalid/prod",
    ]) {
      for (const nodeEnv of ["development", "production"] as const) {
        try {
          assertSeedTarget(url, nodeEnv, "wrong");
        } catch (error) {
          const message = (error as Error).message;
          for (const leak of [
            "neon_user",
            "neon-secret-pw",
            "secret-pw",
            "topsecret",
            "neondb",
            "sslmode",
          ]) {
            expect(message).not.toContain(leak);
          }
        }
      }
    }
  });

  it("rejects NODE_ENV=production even for a local host and with the flag set", () => {
    expect(() => assertSeedTarget(local("localhost"), "production", undefined)).toThrow(
      /production/,
    );
    expect(() => assertSeedTarget(neon, "production", SEED_ALLOW_REMOTE_VALUE)).toThrow(
      /production/,
    );
  });

  it.each(["true", "1", "I-UNDERSTAND-THIS-WRITES-DEMO-ACCOUNTS", ""])(
    "rejects a remote host with the wrong flag %j",
    (flag) => {
      expect(() => assertSeedTarget(neon, "development", flag)).toThrow(/SEED_ALLOW_REMOTE/);
    },
  );

  it("accepts a remote host outside production with the exact flag", () => {
    expect(() => assertSeedTarget(neon, "development", SEED_ALLOW_REMOTE_VALUE)).not.toThrow();
    expect(() => assertSeedTarget(neon, "test", SEED_ALLOW_REMOTE_VALUE)).not.toThrow();
  });

  it.each([undefined, "", "   ", "not a url", "postgresql://", "localhost:5433/simpul_dev"])(
    "rejects an invalid or empty url %j",
    (url) => {
      expect(() => assertSeedTarget(url, "development", undefined)).toThrow(/not a valid/);
    },
  );

  it("does not echo an invalid url, which may hold a password", () => {
    expect(() =>
      assertSeedTarget("postgres://u:topsecret@@bad host/db", "development", undefined),
    ).toThrow(expect.objectContaining({ message: expect.not.stringContaining("topsecret") }));
  });

  // pg-connection-string lets ?host= override the host in the URL, which would bypass the check.
  it.each(["?host=db.example.invalid", "?hostaddr=10.0.0.5", "?HOST=db.example.invalid"])(
    "rejects a local host that is overridden by the query %s",
    (query) => {
      expect(() => assertSeedTarget(local("localhost") + query, "development", undefined)).toThrow(
        /host/,
      );
    },
  );

  it("does not accept a host that only starts or ends with a local name", () => {
    for (const host of ["localhost.evil.test", "evil-localhost", "127.0.0.1.evil.test"]) {
      expect(() => assertSeedTarget(local(host), "development", undefined)).toThrow(
        /SEED_ALLOW_REMOTE/,
      );
    }
  });
});

describe("resolveDemoPassword (demo seed, E6-03)", () => {
  it("keeps the committed local passwords on a local database", () => {
    expect(resolveDemoPassword(local("localhost"), undefined)).toBeUndefined();
    expect(resolveDemoPassword(local("127.0.0.1"), "ignored-pass-1")).toBeUndefined();
  });

  it("refuses a remote database without DEMO_PASSWORD", () => {
    expect(() => resolveDemoPassword(neon, undefined)).toThrow(/DEMO_PASSWORD/);
    expect(() => resolveDemoPassword(neon, "")).toThrow(/DEMO_PASSWORD/);
  });

  it("uses DEMO_PASSWORD on a remote database when it follows the password rules", () => {
    expect(resolveDemoPassword(neon, "remote-demo-pass-7")).toBe("remote-demo-pass-7");
  });

  it("rejects a weak DEMO_PASSWORD without echoing it", () => {
    expect(() => resolveDemoPassword(neon, "short1")).toThrow(/password rules/);
    expect(() => resolveDemoPassword(neon, "short1")).not.toThrow(/short1/);
  });

  it("treats an unparsable URL as not local", () => {
    expect(isLocalDatabase("not a url")).toBe(false);
    expect(isLocalDatabase(undefined)).toBe(false);
  });
});
