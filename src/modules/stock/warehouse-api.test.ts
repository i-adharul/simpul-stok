import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../lib/env";
import type { PrismaClient } from "../../generated/prisma/client";
import { assertTestDatabaseUrl, createTestPrisma } from "../../test/test-database";
import {
  callRoute,
  cookieFor,
  createTwoTenants,
  type RouteHandler,
  type TwoTenants,
} from "../../test/tenant-isolation/fixtures";
import * as listRoute from "../../app/api/warehouses/route";
import * as itemRoute from "../../app/api/warehouses/[id]/route";

let prisma: PrismaClient;
let t: TwoTenants;

beforeAll(() => {
  prisma = createTestPrisma(assertTestDatabaseUrl(env.TEST_DATABASE_URL));
});
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  t = await createTwoTenants(prisma);
});

const call = async (
  handler: RouteHandler,
  role: "OWNER" | "WAREHOUSE_ADMIN" | "VIEWER",
  options: { method: string; path: string; body?: unknown; id?: string },
) =>
  callRoute(handler, {
    method: options.method,
    path: options.path,
    body: options.body,
    cookie: await cookieFor(t.a.users[role]),
    params: options.id ? { id: options.id } : undefined,
  });

describe("POST /api/warehouses", () => {
  it("stores the code uppercase and creates the row in the session's organization", async () => {
    const res = await call(listRoute.POST, "OWNER", {
      method: "POST",
      path: "/api/warehouses",
      body: { code: " gd-01 ", name: "Gudang 1", address: "" },
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toMatchObject({ code: "GD-01", name: "Gudang 1", address: null });
    const row = await prisma.warehouse.findUniqueOrThrow({ where: { id: json.id } });
    expect(row.organizationId).toBe(t.a.organizationId);
  });

  it("returns 409 CONFLICT for a duplicate code, also in another letter case", async () => {
    const body = { code: "W1", name: "Duplicate" };
    const res = await call(listRoute.POST, "OWNER", {
      method: "POST",
      path: "/api/warehouses",
      body,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: "CONFLICT",
      message: "Kode gudang sudah dipakai.",
    });
    const lower = await call(listRoute.POST, "OWNER", {
      method: "POST",
      path: "/api/warehouses",
      body: { code: "w1", name: "Duplicate" },
    });
    expect(lower.status).toBe(409);
  });

  it("allows the same code in another organization", async () => {
    await prisma.warehouse.deleteMany({
      where: { organizationId: t.b.organizationId, code: "W9" },
    });
    await prisma.warehouse.create({
      data: { organizationId: t.b.organizationId, code: "W9", name: "B" },
    });
    const res = await call(listRoute.POST, "OWNER", {
      method: "POST",
      path: "/api/warehouses",
      body: { code: "W9", name: "A" },
    });
    expect(res.status).toBe(201);
  });

  it("rejects an invalid body and a forbidden role", async () => {
    const bad = await call(listRoute.POST, "OWNER", {
      method: "POST",
      path: "/api/warehouses",
      body: { code: "", name: "x", organizationId: t.b.organizationId },
    });
    expect(bad.status).toBe(400);
    const denied = await call(listRoute.POST, "WAREHOUSE_ADMIN", {
      method: "POST",
      path: "/api/warehouses",
      body: { code: "X1", name: "x" },
    });
    expect(denied.status).toBe(403);
  });
});

describe("GET /api/warehouses", () => {
  it("shows the owner every active warehouse with a total, and pages", async () => {
    const res = await call(listRoute.GET, "OWNER", {
      method: "GET",
      path: "/api/warehouses?pageSize=1",
    });
    const json = await res.json();
    expect(json).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(json.items).toHaveLength(1);
  });

  it("shows a viewer only the assigned warehouse", async () => {
    const res = await call(listRoute.GET, "VIEWER", { method: "GET", path: "/api/warehouses" });
    const json = await res.json();
    expect(json.items.map((w: { id: string }) => w.id)).toEqual([t.a.warehouseId]);
    expect(json.total).toBe(1);
  });

  it("hides archived warehouses unless the owner asks, and never shows them to a viewer", async () => {
    await prisma.warehouse.updateMany({
      where: { organizationId: t.a.organizationId, code: "W2" },
      data: { archivedAt: new Date() },
    });
    const path = "/api/warehouses?includeArchived=true";
    const plain = await (
      await call(listRoute.GET, "OWNER", { method: "GET", path: "/api/warehouses" })
    ).json();
    const all = await (await call(listRoute.GET, "OWNER", { method: "GET", path })).json();
    const viewer = await (await call(listRoute.GET, "VIEWER", { method: "GET", path })).json();
    expect(plain.total).toBe(1);
    expect(all.total).toBe(2);
    expect(viewer.total).toBe(1);
  });
});

describe("GET /api/warehouses/:id", () => {
  const get = (role: "OWNER" | "VIEWER", id: string) =>
    call(itemRoute.GET, role, { method: "GET", path: `/api/warehouses/${id}`, id });

  it("returns an assigned warehouse", async () => {
    expect((await get("VIEWER", t.a.warehouseId)).status).toBe(200);
  });

  it("returns 403 for a warehouse of the organization that is not assigned to the viewer", async () => {
    const other = await prisma.warehouse.findFirstOrThrow({
      where: { organizationId: t.a.organizationId, code: "W2" },
    });
    expect((await get("VIEWER", other.id)).status).toBe(403);
    expect((await get("OWNER", other.id)).status).toBe(200);
  });

  it("returns 404 for another organization's warehouse and for an archived one", async () => {
    expect((await get("OWNER", t.b.warehouseId)).status).toBe(404);
    await prisma.warehouse.update({
      where: { id: t.a.warehouseId },
      data: { archivedAt: new Date() },
    });
    expect((await get("OWNER", t.a.warehouseId)).status).toBe(404);
  });
});

describe("PATCH /api/warehouses/:id", () => {
  const patch = (id: string, body: unknown, role: "OWNER" | "VIEWER" = "OWNER") =>
    call(itemRoute.PATCH, role, { method: "PATCH", path: `/api/warehouses/${id}`, id, body });

  it("updates name, address and code (uppercased)", async () => {
    const res = await patch(t.a.warehouseId, { code: "new-1", name: "Baru", address: "Jl. A" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ code: "NEW-1", name: "Baru", address: "Jl. A" });
  });

  it("returns 409 when the code belongs to another warehouse of the organization", async () => {
    expect((await patch(t.a.warehouseId, { code: "W2" })).status).toBe(409);
  });

  it("returns 400 for an empty body or archived, 403 for a viewer, 404 for a foreign id", async () => {
    expect((await patch(t.a.warehouseId, {})).status).toBe(400);
    expect((await patch(t.a.warehouseId, { archived: true })).status).toBe(400);
    expect((await patch(t.a.warehouseId, { name: "x" }, "VIEWER")).status).toBe(403);
    expect((await patch(t.b.warehouseId, { name: "x" })).status).toBe(404);
  });
});
