import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "./proxy";

const HOST = "app.example.com";

function request(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`https://${HOST}${path}`, {
    method: init.method ?? "GET",
    headers: { host: HOST, ...init.headers },
  });
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("proxy CSRF check", () => {
  it("rejects a login POST from a foreign origin with 403, no-store, and one log line", async () => {
    const response = await proxy(
      request("/api/auth/login", {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          cookie: "__Host-simpul_session=secret-token",
          authorization: "Bearer secret",
          "x-request-id": "0199aaaa-bbbb-7ccc-8ddd-eeeeffff0001",
        },
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("0199aaaa-bbbb-7ccc-8ddd-eeeeffff0001");
    expect(await response.json()).toEqual({
      code: "CSRF_REJECTED",
      message: "Request origin is not allowed.",
      details: null,
    });

    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(JSON.parse(line)).toMatchObject({
      level: "warn",
      event: "csrf.rejected",
      requestId: "0199aaaa-bbbb-7ccc-8ddd-eeeeffff0001",
      method: "POST",
      path: "/api/auth/login",
      reason: "origin_mismatch",
    });
    expect(line).not.toContain("secret");
    expect(line).not.toContain("evil.example");
  });

  it("rejects a write without Origin with 403 and reason origin_missing", async () => {
    const response = await proxy(request("/api/auth/login", { method: "POST" }));
    expect(response.status).toBe(403);
    expect(JSON.parse(String(warn.mock.calls[0][0])).reason).toBe("origin_missing");
  });

  it("rejects an http Origin on an https host", async () => {
    const response = await proxy(
      request("/api/auth/login", { method: "POST", headers: { origin: `http://${HOST}` } }),
    );
    expect(response.status).toBe(403);
    expect(JSON.parse(String(warn.mock.calls[0][0])).reason).toBe("origin_mismatch");
  });

  it("uses x-forwarded-proto over the URL scheme", async () => {
    const forwarded = new NextRequest(`http://${HOST}/api/auth/login`, {
      method: "POST",
      headers: { host: HOST, "x-forwarded-proto": "https", origin: `http://${HOST}` },
    });
    expect((await proxy(forwarded)).status).toBe(403);
  });

  it("forwards a write from the same origin without logging", async () => {
    const response = await proxy(
      request("/api/auth/login", { method: "POST", headers: { origin: `https://${HOST}` } }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(warn).not.toHaveBeenCalled();
  });

  it("forwards a GET without Origin", async () => {
    const response = await proxy(request("/api/me"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(warn).not.toHaveBeenCalled();
  });

  it("forwards the Xendit webhook without Origin", async () => {
    const response = await proxy(request("/api/webhooks/xendit", { method: "POST" }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(warn).not.toHaveBeenCalled();
  });
});
