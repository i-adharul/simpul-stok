import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { env } from "../../lib/env";
import type { PrismaClient } from "../../generated/prisma/client";
import { assertTestDatabaseUrl, createTestPrisma } from "../../test/test-database";
import { DEMO_ACCOUNTS, seedBase } from "./seed";
import { SESSION_COOKIE_NAME, createSessionToken } from "./session";
import { createTenantRoute } from "./tenant-route";

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

  it("keeps the route options readable for route-validation.test.ts", () => {
    const wrapped = withTenantRoute(async () => new Response(null), {
      body: "none",
      route: "/api/x/[id]",
    });
    expect(wrapped.apiOptions).toMatchObject({ body: "none", route: "/api/x/[id]" });
  });
});
