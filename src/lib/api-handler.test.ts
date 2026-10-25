import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, ERROR_CODES } from "./api-error";
import { withApiLog } from "./api-handler";
import { parseInput } from "./api-input";

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

  it("passes every handler argument through, including the route context", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    type Context = { params: Promise<{ id: string }> };
    const context: Context = { params: Promise.resolve({ id: "abc" }) };
    const handler = vi.fn<(request: Request, context: Context) => Response>(
      () => new Response(null),
    );
    const incoming = request("/api/things/abc");

    await withApiLog(handler)(incoming, context);

    expect(handler).toHaveBeenCalledWith(incoming, context);
    expect(handler.mock.calls[0][1]).toBe(context);
  });

  it("logs the route label instead of the raw path when one is given", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const handler = withApiLog(async () => new Response(null), {
      route: "/api/invitations/[token]",
    });

    await handler(request("/api/invitations/s3cr3t-invite-token"));

    const output = String(info.mock.calls[0][0]);
    expect(JSON.parse(output).path).toBe("/api/invitations/[token]");
    expect(output).not.toContain("s3cr3t-invite-token");
  });

  it("keeps logging the pathname when no route label is given", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await withApiLog(async () => new Response(null))(request("/api/things/abc"));
    expect(JSON.parse(String(info.mock.calls[0][0])).path).toBe("/api/things/abc");
  });

  it("sets the request ID on a response whose headers are immutable", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const immutable = Response.redirect("http://localhost/elsewhere", 302);
    expect(() => immutable.headers.set("x-test", "1")).toThrow();

    const response = await withApiLog(async () => immutable)(
      request("/api/thing", { "x-request-id": "req-12345678" }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost/elsewhere");
    expect(response.headers.get("x-request-id")).toBe("req-12345678");
  });
});

describe("withApiLog with ApiError and parseInput", () => {
  const schemas = {
    body: z.object({ name: z.string().min(1) }),
    query: z.object({ page: z.coerce.number().int().min(1) }),
    params: z.object({ id: z.uuid() }),
  };
  const post = (path: string, body: string) =>
    new Request(`http://localhost${path}`, { method: "POST", body });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const goodId = "6f1c1f1e-3b0b-4a43-9a6e-0b3f6f1c1f1e";

  it("returns 400 with details for invalid body, query and params together", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const handler = withApiLog(async (req: Request, c: ReturnType<typeof ctx>) => {
      await parseInput(req, c, schemas);
      return Response.json({ ok: true });
    });

    const response = await handler(post("/api/x?page=0", '{"name":""}'), ctx("nope"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.details.map((d: { source: string }) => d.source).sort()).toEqual([
      "body",
      "params",
      "query",
    ]);
  });

  it("returns 400 for a body that is not JSON and does not echo it", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const handler = withApiLog(async (req: Request) => {
      await parseInput(req, undefined, { body: schemas.body });
      return new Response(null);
    });
    const response = await handler(post("/api/x", "not-json-secret"));
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain("not-json-secret");
  });

  it("passes parsed, coerced values to the handler", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const handler = withApiLog(async (req: Request, c: ReturnType<typeof ctx>) => {
      const input = await parseInput(req, c, schemas);
      return Response.json(input);
    });
    const response = await handler(post("/api/x?page=2", '{"name":"Gudang"}'), ctx(goodId));
    expect(await response.json()).toEqual({
      body: { name: "Gudang" },
      query: { page: 2 },
      params: { id: goodId },
    });
  });

  it("maps a thrown ApiError through the error convention and logs it as info", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withApiLog(async () => {
      throw new ApiError(409, ERROR_CODES.CONFLICT, "Sudah ada.", { field: "code" });
    });

    const response = await handler(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "CONFLICT",
      message: "Sudah ada.",
      details: { field: "code" },
    });
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(info).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("still turns an unexpected error into a 500 without a stack", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withApiLog(async () => {
      throw new TypeError("boom at /srv/x.ts:9");
    });
    const response = await handler(request());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("boom");
  });
});
