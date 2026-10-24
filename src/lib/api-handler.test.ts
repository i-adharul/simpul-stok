import { afterEach, describe, expect, it, vi } from "vitest";
import { withApiLog } from "./api-handler";

afterEach(() => {
  vi.restoreAllMocks();
});

function request(path = "/api/thing", headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}?secret=1`, { headers });
}

describe("withApiLog", () => {
  it("logs one line with requestId, method, path, status and durationMs", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const handler = withApiLog(async () => Response.json({ ok: true }, { status: 201 }));

    const response = await handler(request("/api/thing", { "x-request-id": "req-12345678" }));

    expect(response.status).toBe(201);
    expect(info).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(info.mock.calls[0][0]));
    expect(line).toMatchObject({
      event: "api.request",
      requestId: "req-12345678",
      method: "GET",
      path: "/api/thing",
      status: 201,
    });
    expect(line.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("does not log the query string", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await withApiLog(async () => new Response(null))(request());
    expect(String(info.mock.calls[0][0])).not.toContain("secret");
  });

  it("returns the request ID in the response header", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await withApiLog(async () => new Response(null))(
      request("/api/thing", { "x-request-id": "req-12345678" }),
    );
    expect(response.headers.get("x-request-id")).toBe("req-12345678");
  });

  it("creates a request ID when the request has none", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await withApiLog(async () => new Response(null))(request());
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("turns an unhandled error into a 500 without a stack trace (BL29)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withApiLog(async () => {
      throw new Error("secret internals at /srv/app.ts:1");
    });

    const response = await handler(request("/api/thing", { "x-request-id": "req-12345678" }));

    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBe("req-12345678");
    const body = await response.json();
    expect(body).toEqual({ code: "INTERNAL_ERROR", message: expect.any(String), details: null });
    expect(JSON.stringify(body)).not.toContain("secret internals");
    // The detail stays in the server log, with the same request ID.
    const line = JSON.parse(String(error.mock.calls[0][0]));
    expect(line).toMatchObject({
      requestId: "req-12345678",
      status: 500,
      errorMessage: "secret internals at /srv/app.ts:1",
    });
  });
});
