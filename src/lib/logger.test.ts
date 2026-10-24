import { afterEach, describe, expect, it, vi } from "vitest";
import { errorFields, log } from "./logger";

afterEach(() => {
  vi.restoreAllMocks();
});

function lastLine(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const call = spy.mock.calls.at(-1);
  return JSON.parse(String(call?.[0]));
}

describe("log", () => {
  it("writes one JSON line with time, level, event and the given fields", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    log("info", "api.request", { requestId: "r-1", status: 200 });

    expect(spy).toHaveBeenCalledTimes(1);
    const line = lastLine(spy);
    expect(line).toMatchObject({
      level: "info",
      event: "api.request",
      requestId: "r-1",
      status: 200,
    });
    expect(new Date(String(line.time)).toISOString()).toBe(line.time);
  });

  it("uses console.error for errors and console.warn for warnings", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    log("error", "e", {});
    log("warn", "w", {});

    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not let a field overwrite level, event or time", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    log("info", "real", { level: "fake", event: "fake", time: "fake" });

    expect(lastLine(spy)).toMatchObject({ level: "info", event: "real" });
    expect(lastLine(spy).time).not.toBe("fake");
  });

  it("redacts fields that look like secrets", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    log("info", "x", {
      password: "hunter2",
      authorization: "Bearer abc",
      DATABASE_URL: "postgresql://u:p@h/db",
      sessionToken: "t",
      ok: "visible",
    });

    const line = lastLine(spy);
    expect(line.password).toBe("[redacted]");
    expect(line.authorization).toBe("[redacted]");
    expect(line.DATABASE_URL).toBe("[redacted]");
    expect(line.sessionToken).toBe("[redacted]");
    expect(line.ok).toBe("visible");
  });
});

describe("errorFields", () => {
  it("describes an Error with name, message and stack", () => {
    const fields = errorFields(new TypeError("boom"));
    expect(fields).toMatchObject({ errorName: "TypeError", errorMessage: "boom" });
    expect(String(fields.stack)).toContain("boom");
  });

  it("handles a thrown value that is not an Error", () => {
    expect(errorFields("oops")).toEqual({ errorName: "NonError", errorMessage: "oops" });
  });
});
