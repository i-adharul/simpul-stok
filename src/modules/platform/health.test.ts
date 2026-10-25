import { afterEach, describe, expect, it, vi } from "vitest";
import { createHealthChecker, toHealthResponse } from "./health";

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(
  options: { ping?: () => Promise<void>; timeoutMs?: number; failureTtlMs?: number } = {},
) {
  let time = 1_000_000;
  const ping = vi.fn(options.ping ?? (async () => {}));
  const check = createHealthChecker({
    ping,
    now: () => time,
    ttlMs: 60_000,
    failureTtlMs: options.failureTtlMs,
    timeoutMs: options.timeoutMs ?? 1_000,
  });
  return { ping, check, advance: (ms: number) => (time += ms) };
}

describe("createHealthChecker", () => {
  it("reports the database as up when the ping succeeds", async () => {
    const { check } = setup();
    const result = await check();
    expect(result.up).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("runs the ping once for calls within 60 seconds", async () => {
    const { ping, check, advance } = setup();

    await check();
    advance(59_999);
    await check();

    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("runs the ping again after 60 seconds", async () => {
    const { ping, check, advance } = setup();

    await check();
    advance(60_000);
    await check();

    expect(ping).toHaveBeenCalledTimes(2);
  });

  it("shares one ping between simultaneous calls", async () => {
    const { ping, check } = setup();
    await Promise.all([check(), check(), check()]);
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("reports down when the ping fails, and logs only the error name, Prisma code and cause name", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { check } = setup({
      ping: async () => {
        const error = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), {
          code: "P1001",
          meta: { driverAdapterError: { name: "ConnectionError" } },
        });
        error.stack = "Error: boom\n    at ping (/srv/app/src/lib/db.ts:12:3)";
        throw error;
      },
    });

    const result = await check();

    expect(result.up).toBe(false);
    expect(JSON.stringify(result)).not.toContain("ECONNREFUSED");
    const output = String(warn.mock.calls[0][0]);
    expect(JSON.parse(output)).toMatchObject({
      event: "health.database_down",
      errorName: "Error",
      prismaCode: "P1001",
      causeName: "ConnectionError",
    });
    expect(output).not.toContain("stack");
    expect(output).not.toContain("/srv/app");
    expect(output).not.toContain("ECONNREFUSED");
  });

  it("logs only the error name when the error has no Prisma code or cause", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { check } = setup({ ping: () => new Promise(() => {}), timeoutMs: 10 });
    await check();
    const line = JSON.parse(String(warn.mock.calls[0][0]));
    expect(line).toMatchObject({ errorName: "Error" });
    expect(line).not.toHaveProperty("prismaCode");
    expect(line).not.toHaveProperty("causeName");
    expect(line).not.toHaveProperty("stack");
  });

  it("reports down when the ping takes longer than the timeout", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { check } = setup({ ping: () => new Promise(() => {}), timeoutMs: 20 });
    expect((await check()).up).toBe(false);
  });

  it("caches a down result too, so a dead database is not pinged by every call", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ping, check } = setup({
      ping: async () => {
        throw new Error("x");
      },
    });
    await check();
    await check();
    expect(ping).toHaveBeenCalledTimes(1);
  });
});

describe("createHealthChecker failure cache", () => {
  it("pings again 15 seconds after a failure by default, not before", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ping, check, advance } = setup({
      ping: async () => {
        throw new Error("x");
      },
    });
    await check();
    advance(14_999);
    await check();
    expect(ping).toHaveBeenCalledTimes(1);
    advance(1);
    await check();
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it("uses a custom failureTtlMs", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ping, check, advance } = setup({
      failureTtlMs: 1_000,
      ping: async () => {
        throw new Error("x");
      },
    });
    await check();
    advance(1_000);
    await check();
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it("keeps a successful result for the full ttl", async () => {
    const { ping, check, advance } = setup();
    await check();
    advance(59_999);
    await check();
    expect(ping).toHaveBeenCalledTimes(1);
  });
});

describe("toHealthResponse", () => {
  it("returns 200 with the first 7 characters of the commit when the database is up", () => {
    const { status, body } = toHealthResponse({ up: true, latencyMs: 12 }, "0123456789abcdef");
    expect(status).toBe(200);
    expect(body).toEqual({
      status: "ok",
      app: { commit: "0123456" },
      database: { status: "up", latencyMs: 12 },
    });
  });

  it("uses null for the commit when it is missing or empty", () => {
    expect(toHealthResponse({ up: true, latencyMs: 1 }, undefined).body.app.commit).toBeNull();
    expect(toHealthResponse({ up: true, latencyMs: 1 }, "").body.app.commit).toBeNull();
  });

  it("returns 503 without latency, host or version when the database is down", () => {
    const { status, body } = toHealthResponse({ up: false, latencyMs: 8000 }, "abcdef1234");
    expect(status).toBe(503);
    expect(body).toEqual({
      status: "error",
      app: { commit: "abcdef1" },
      database: { status: "down" },
    });
  });
});
