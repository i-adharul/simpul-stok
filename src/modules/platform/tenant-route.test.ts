import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { env } from "../../lib/env";
import type { PrismaClient } from "../../generated/prisma/client";
import { assertTestDatabaseUrl, createTestPrisma } from "../../test/test-database";
import { DEMO_ACCOUNTS, seedBase } from "./seed";
import { SESSION_COOKIE_NAME, createSessionToken } from "./session";
import { createTenantRoute, isTenantGuard } from "./tenant-route";

const secret = env.SESSION_SECRET;
let prisma: PrismaClient;
let withTenantRoute: ReturnType<typeof createTenantRoute>;
let organizationId: string;
const userIds: Record<string, string> = {};

const bodySchema = z.object({ name: z.string().min(1) });

async function post(body: unknown, role?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (role) {
    headers.cookie = `${SESSION_COOKIE_NAME}=${await createSessionToken(userIds[role], secret)}`;
  }
  return new Request("http://localhost/api/warehouses", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  prisma = createTestPrisma(assertTestDatabaseUrl(env.TEST_DATABASE_URL));
  await prisma.$executeRaw`TRUNCATE TABLE user_warehouses, warehouses, subscriptions, users, plans, organizations RESTART IDENTITY CASCADE`;
  await seedBase(prisma);
  organizationId = (await prisma.organization.findFirstOrThrow()).id;
  for (const a of DEMO_ACCOUNTS) {
    userIds[a.role] = (await prisma.user.findUniqueOrThrow({ where: { email: a.email } })).id;
  }
  const other = await prisma.organization.create({ data: { name: "Other", slug: "other" } });
  await prisma.warehouse.createMany({
    data: [
      { organizationId, code: "OWN", name: "Own" },
      { organizationId: other.id, code: "FOREIGN", name: "Foreign" },
    ],
  });
  withTenantRoute = createTenantRoute({ prisma, secret });
});

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(async () => {
  vi.restoreAllMocks();
  await prisma.$disconnect();
});

describe("withTenantRoute", () => {
  const handler = vi.fn();
  const route = () =>
    withTenantRoute(
      async (_request, input, tenant) => {
        handler(tenant.ctx);
        const rows = await tenant.db.warehouse.findMany({ orderBy: { code: "asc" } });
        return Response.json({ name: input.body.name, codes: rows.map((r) => r.code) });
      },
      { body: bodySchema },
    );

  beforeEach(() => handler.mockClear());

  it("returns 401, not 400, for an unauthenticated request with an invalid body", async () => {
    const response = await route()(await post({ name: 5 }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED", details: null });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 401 for an unauthenticated request with a body that is not JSON", async () => {
    const request = new Request("http://localhost/api/warehouses", {
      method: "POST",
      body: "not json",
    });
    expect((await route()(request)).status).toBe(401);
  });

  it("returns 403 for a platform admin, who never gets a tenant client", async () => {
    const response = await route()(await post({ name: "x" }, "PLATFORM_ADMIN"));
    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 for a platform admin even with an invalid body", async () => {
    expect((await route()(await post({}, "PLATFORM_ADMIN"))).status).toBe(403);
  });

  it("returns 400 for an authenticated request with an invalid body", async () => {
    const response = await route()(await post({ name: "" }, "OWNER"));
    expect(response.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the handler with the context and a client that sees only its own organization", async () => {
    const response = await route()(await post({ name: "ok" }, "OWNER"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: "ok", codes: ["OWN"] });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ userId: userIds.OWNER, organizationId, role: "OWNER" }),
    );
  });

  describe("requires", () => {
    const guarded = () =>
      withTenantRoute(
        async (_request, _input, tenant) => {
          handler(tenant.ctx);
          return Response.json({ ok: true });
        },
        { body: bodySchema, requires: "warehouse.manage" },
      );

    it("returns 403 for a role without the right, even with an invalid body", async () => {
      for (const role of ["WAREHOUSE_ADMIN", "VIEWER"]) {
        const response = await guarded()(await post({}, role));
        expect(response.status, role).toBe(403);
        expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
      }
      expect(handler).not.toHaveBeenCalled();
    });

    it("lets a role with the right reach the input check (400) and the handler (200)", async () => {
      expect((await guarded()(await post({}, "OWNER"))).status).toBe(400);
      expect((await guarded()(await post({ name: "ok" }, "OWNER"))).status).toBe(200);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("still answers 401 without a session and 403 for a platform admin", async () => {
      expect((await guarded()(await post({}))).status).toBe(401);
      expect((await guarded()(await post({}, "PLATFORM_ADMIN"))).status).toBe(403);
    });
  });

  describe("Cache-Control", () => {
    const own = () =>
      withTenantRoute(
        async () => Response.json({ ok: true }, { headers: { "Cache-Control": "max-age=60" } }),
        {
          body: "none",
        },
      );
    const plain = () => withTenantRoute(async () => Response.json({ ok: true }), { body: "none" });

    it("adds no-store to a success response", async () => {
      const response = await plain()(await post({}, "OWNER"));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
    });

    it("adds no-store to error responses (401, 403, 400)", async () => {
      const unauthenticated = await plain()(await post({}));
      expect(unauthenticated.status).toBe(401);
      expect(unauthenticated.headers.get("cache-control")).toBe("no-store");
      const admin = await plain()(await post({}, "PLATFORM_ADMIN"));
      expect(admin.status).toBe(403);
      expect(admin.headers.get("cache-control")).toBe("no-store");
      const invalid = await route()(await post({ name: "" }, "OWNER"));
      expect(invalid.status).toBe(400);
      expect(invalid.headers.get("cache-control")).toBe("no-store");
    });

    it("keeps a Cache-Control the handler set itself", async () => {
      const response = await own()(await post({}, "OWNER"));
      expect(response.headers.get("cache-control")).toBe("max-age=60");
    });
  });

  it("marks its guard so the route inventory can tell a tenant route from a public one", () => {
    const wrapped = withTenantRoute(async () => new Response(null), { body: "none" });
    expect(isTenantGuard(wrapped.apiOptions.guard)).toBe(true);
    expect(isTenantGuard(undefined)).toBe(false);
    expect(isTenantGuard(async () => undefined)).toBe(false);
  });

  it("keeps the route options readable for route-validation.test.ts", () => {
    const wrapped = withTenantRoute(async () => new Response(null), {
      body: "none",
      route: "/api/x/[id]",
    });
    expect(wrapped.apiOptions).toMatchObject({ body: "none", route: "/api/x/[id]" });
  });
});

describe("withTenantRoute with idempotent: true", () => {
  const handler = vi.fn();
  const route = () =>
    withTenantRoute(
      async (_request, _input, tenant) => {
        handler(tenant.idempotencyKey);
        return Response.json({ ok: true });
      },
      { body: bodySchema, requires: "warehouse.manage", idempotent: true },
    );

  async function send(options: { role?: string; key?: string; method?: string; body?: unknown }) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (options.role) {
      headers.cookie = `${SESSION_COOKIE_NAME}=${await createSessionToken(userIds[options.role], secret)}`;
    }
    if (options.key !== undefined) headers["idempotency-key"] = options.key;
    const method = options.method ?? "POST";
    return new Request("http://localhost/api/warehouses", {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(options.body ?? { name: "ok" }),
    });
  }

  beforeEach(() => handler.mockClear());

  it("hands the key to the handler in lower case", async () => {
    const key = "0195E3A2-7C11-7B4E-9F3A-1C2D3E4F5A6B";
    const response = await route()(await send({ role: "OWNER", key }));
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(key.toLowerCase());
  });

  it("returns 400 for a write with a missing key or a key that is not a UUID", async () => {
    for (const key of [undefined, "", "not-a-uuid"]) {
      const response = await route()(await send({ role: "OWNER", key }));
      expect(response.status, String(key)).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "VALIDATION_ERROR",
        details: [{ source: "header", path: "Idempotency-Key" }],
      });
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers 401, 403 before it looks at the key", async () => {
    expect((await route()(await send({}))).status).toBe(401);
    expect((await route()(await send({ role: "PLATFORM_ADMIN" }))).status).toBe(403);
    expect((await route()(await send({ role: "VIEWER" }))).status).toBe(403);
  });

  it("checks the key before the body", async () => {
    const response = await route()(await send({ role: "OWNER", body: {} }));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { details: { source: string }[] }).details).toEqual([
      expect.objectContaining({ source: "header" }),
    ]);
  });

  it("does not ask a read for a key", async () => {
    const reader = withTenantRoute(async () => Response.json({ ok: true }), {
      idempotent: true,
    });
    const response = await reader(await send({ role: "OWNER", method: "GET" }));
    expect(response.status).toBe(200);
  });
});
