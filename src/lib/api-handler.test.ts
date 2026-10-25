import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, ERROR_CODES } from "./api-error";
import { hasRouteLabel, withApiLog } from "./api-handler";

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

  it("passes the request and the route context through to the handler", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    type Context = { params: Promise<{ id: string }> };
    const context: Context = { params: Promise.resolve({ id: "abc" }) };
    const handler = vi.fn<(request: Request, input: unknown, context: Context) => Response>(
      () => new Response(null),
    );
    const incoming = request("/api/things/abc");

    await withApiLog(handler)(incoming, context);

    expect(handler.mock.calls[0][0]).toBe(incoming);
    expect(handler.mock.calls[0][2]).toBe(context);
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

describe("withApiLog input validation", () => {
  const schemas = {
    body: z.object({ name: z.string().min(1) }),
    query: z.object({ page: z.coerce.number().int().min(1) }),
    params: z.object({ id: z.uuid() }),
  };
  const post = (path: string, body: string) =>
    new Request(`http://localhost${path}`, { method: "POST", body });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const goodId = "6f1c1f1e-3b0b-4a43-9a6e-0b3f6f1c1f1e";

  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns 400 with details for invalid body, query and params together, without calling the handler", async () => {
    const inner = vi.fn(async () => Response.json({ ok: true }));
    const handler = withApiLog(inner, { ...schemas, route: "/api/x/[id]" });

    const response = await handler(post("/api/x/nope?page=0", '{"name":""}'), ctx("nope"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.details.map((d: { source: string }) => d.source).sort()).toEqual([
      "body",
      "params",
      "query",
    ]);
    expect(inner).not.toHaveBeenCalled();
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("returns 400 for a body that is not JSON, does not echo it and does not call the handler", async () => {
    const inner = vi.fn(async () => new Response(null));
    const response = await withApiLog(inner, { body: schemas.body })(
      post("/api/x", "not-json-secret"),
    );
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain("not-json-secret");
    expect(inner).not.toHaveBeenCalled();
  });

  it("never echoes a rejected value", async () => {
    const response = await withApiLog(async () => new Response(null), { body: schemas.body })(
      post("/api/x", '{"name":123456789}'),
    );
    expect(JSON.stringify(await response.json())).not.toContain("123456789");
  });

  it("uses a custom message and no details when the rules are sensitive", async () => {
    const handler = withApiLog(async () => new Response(null), {
      body: z.object({ password: z.string().min(12) }),
      invalidMessage: "Password wajib diisi.",
      hideIssues: true,
    });
    const response = await handler(post("/api/x", '{"password":"short"}'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "VALIDATION_ERROR",
      message: "Password wajib diisi.",
      details: null,
    });
  });

  it("passes the parsed, coerced values to the handler as typed input", async () => {
    const handler = withApiLog(async (_req, input) => {
      // Compile-time check: these are the schema output types.
      const name: string = input.body.name;
      const page: number = input.query.page;
      const id: string = input.params.id;
      return Response.json({ name, page, id });
    }, schemas);
    const response = await handler(post("/api/x?page=2", '{"name":"Gudang"}'), ctx(goodId));
    expect(await response.json()).toEqual({ name: "Gudang", page: 2, id: goodId });
  });

  it("does not read the body when the route declares body: none", async () => {
    const inner = vi.fn(async () => new Response(null, { status: 204 }));
    const response = await withApiLog(inner, { body: "none" })(post("/api/x", "ignored"));
    expect(response.status).toBe(204);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "rejects a %s route with no validation decision, without calling the handler",
    async (method) => {
      const inner = vi.fn(async () => new Response(null));
      const response = await withApiLog(inner)(
        new Request("http://localhost/api/x", { method, body: "{}" }),
      );
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ code: "INTERNAL_ERROR", details: null });
      expect(inner).not.toHaveBeenCalled();
    },
  );

  it("accepts a GET route with no validation decision", async () => {
    const response = await withApiLog(async () => new Response(null, { status: 204 }))(request());
    expect(response.status).toBe(204);
  });
});

describe("withApiLog error mapping", () => {
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

describe("withApiLog guard", () => {
  const post = (body: string) =>
    new Request("http://localhost/api/thing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

  it("runs the guard before the input is validated: 401 wins over 400", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const route = withApiLog(handler, {
      body: z.object({ name: z.string() }),
      guard: async () => {
        throw new ApiError(401, ERROR_CODES.UNAUTHENTICATED, "Sesi tidak valid.");
      },
    });

    const response = await route(post(JSON.stringify({ name: 5 })));

    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain("name");
  });

  it("does not even parse the body when the guard fails", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const route = withApiLog(async () => new Response(null), {
      body: z.object({}),
      guard: async () => {
        throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Tidak boleh.");
      },
    });
    expect((await route(post("not json"))).status).toBe(403);
  });

  it("validates after the guard and hands the guard result to the handler", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const route = withApiLog(
      async (_request, input, _context, guarded) =>
        Response.json({ name: input.body.name, who: guarded.who }),
      { body: z.object({ name: z.string() }), guard: async () => ({ who: "me" }) },
    );

    expect((await route(post(JSON.stringify({ name: 5 })))).status).toBe(400);
    const ok = await route(post(JSON.stringify({ name: "x" })));
    expect(await ok.json()).toEqual({ name: "x", who: "me" });
  });

  it("turns an unexpected guard error into a 500 without a stack", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const route = withApiLog(async () => new Response(null), {
      guard: async () => {
        throw new Error("db down");
      },
    });
    const response = await route(request());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("db down");
  });

  it("leaves routes without a guard unchanged", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const route = withApiLog(async (_r, _i, _c, guarded) =>
      Response.json({ guarded: guarded ?? null }),
    );
    expect(await (await route(request())).json()).toEqual({ guarded: null });
  });
});

describe("hasRouteLabel", () => {
  it("accepts a static route without a label", () => {
    expect(hasRouteLabel("auth/login/route.ts", {})).toBe(true);
  });

  it("requires a label for a dynamic segment", () => {
    expect(hasRouteLabel("invitations/[token]/route.ts", {})).toBe(false);
    expect(hasRouteLabel("warehouses/[id]/stock/route.ts", {})).toBe(false);
    expect(
      hasRouteLabel("invitations/[token]/route.ts", { route: "/api/invitations/[token]" }),
    ).toBe(true);
  });

  it("also understands a Windows path", () => {
    expect(hasRouteLabel("invitations\\[token]\\route.ts", {})).toBe(false);
  });
});
