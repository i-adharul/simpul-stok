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
import * as listRoute from "../../app/api/products/route";
import * as itemRoute from "../../app/api/products/[id]/route";

let prisma: PrismaClient;
let t: TwoTenants;
type Role = "OWNER" | "WAREHOUSE_ADMIN" | "VIEWER";

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
  role: Role,
  options: { method: string; path: string; body?: unknown; id?: string },
) =>
  callRoute(handler, {
    method: options.method,
    path: options.path,
    body: options.body,
    cookie: await cookieFor(t.a.users[role]),
    params: options.id ? { id: options.id } : undefined,
  });

const post = (body: unknown, role: Role = "OWNER") =>
  call(listRoute.POST, role, { method: "POST", path: "/api/products", body });
const list = (path = "/api/products", role: Role = "OWNER") =>
  call(listRoute.GET, role, { method: "GET", path });
const get = (id: string, role: Role = "OWNER") =>
  call(itemRoute.GET, role, { method: "GET", path: `/api/products/${id}`, id });
const patch = (id: string, body: unknown, role: Role = "OWNER") =>
  call(itemRoute.PATCH, role, { method: "PATCH", path: `/api/products/${id}`, id, body });

const makeProduct = (organizationId: string, sku: string, archivedAt: Date | null = null) =>
  prisma.product.create({ data: { organizationId, sku, name: sku, unit: "pcs", archivedAt } });
const archivedAt = async (id: string) =>
  (await prisma.product.findUniqueOrThrow({ where: { id } })).archivedAt;

describe("POST /api/products", () => {
  it("stores the SKU uppercase without spaces, defaults minStock to 0, in the session's organization", async () => {
    const res = await post({ sku: " ab 12\tc ", name: "Beras", unit: "pcs" });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toMatchObject({ sku: "AB12C", name: "Beras", unit: "pcs", minStock: 0 });
    const row = await prisma.product.findUniqueOrThrow({ where: { id: json.id } });
    expect(row.organizationId).toBe(t.a.organizationId);
  });

  it("returns 409 for a duplicate SKU, also in another letter case or with spaces", async () => {
    await makeProduct(t.a.organizationId, "DUP1");
    for (const sku of ["DUP1", "dup1", "d u p1"]) {
      const res = await post({ sku, name: "x", unit: "pcs" });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "CONFLICT", message: "SKU sudah dipakai." });
    }
  });

  it("allows the same SKU in another organization", async () => {
    await makeProduct(t.b.organizationId, "SHARED");
    expect((await post({ sku: "shared", name: "A", unit: "pcs" })).status).toBe(201);
  });

  it("rejects an invalid unit, a negative or fractional minStock, an empty SKU and extra keys", async () => {
    const base = { sku: "OK1", name: "x", unit: "pcs" };
    for (const bad of [
      { ...base, unit: "kg" },
      { ...base, minStock: -1 },
      { ...base, minStock: 1.5 },
      { ...base, sku: "  " },
      { ...base, organizationId: t.b.organizationId },
    ]) {
      expect((await post(bad)).status).toBe(400);
    }
    expect(await prisma.product.count({ where: { sku: "OK1" } })).toBe(0);
  });

  it("returns 403 for a Warehouse Admin and a Viewer", async () => {
    const body = { sku: "X1", name: "x", unit: "pcs" };
    expect((await post(body, "WAREHOUSE_ADMIN")).status).toBe(403);
    expect((await post(body, "VIEWER")).status).toBe(403);
  });
});

describe("GET /api/products", () => {
  it("lists the organization's active products with a total, pages, and never another organization's", async () => {
    await makeProduct(t.a.organizationId, "A1");
    await makeProduct(t.a.organizationId, "A2");
    await makeProduct(t.b.organizationId, "B1");
    // The fixture already holds SKU-1 in each organization, so A has 3 products: A1, A2, SKU-1.
    const json = await (await list("/api/products?pageSize=1&page=2")).json();
    expect(json).toMatchObject({ total: 3, page: 2, pageSize: 1 });
    expect(json.items.map((p: { sku: string }) => p.sku)).toEqual(["A2"]);
  });

  it("every tenant role can read", async () => {
    await makeProduct(t.a.organizationId, "A1");
    for (const role of ["OWNER", "WAREHOUSE_ADMIN", "VIEWER"] as const) {
      const res = await list("/api/products", role);
      expect(res.status).toBe(200);
      expect((await res.json()).total).toBe(2);
    }
  });

  it("passes includeArchived to the owner only", async () => {
    await makeProduct(t.a.organizationId, "ACTIVE");
    await makeProduct(t.a.organizationId, "OLD", new Date());
    const path = "/api/products?includeArchived=true";
    // Plus the fixture's SKU-1.
    expect((await (await list()).json()).total).toBe(2);
    expect((await (await list(path)).json()).total).toBe(3);
    expect((await (await list(path, "VIEWER")).json()).total).toBe(2);
    expect((await (await list(path, "WAREHOUSE_ADMIN")).json()).total).toBe(2);
  });

  it("returns 400 for an invalid page size", async () => {
    expect((await list("/api/products?pageSize=1000")).status).toBe(400);
  });
});

describe("GET /api/products/:id", () => {
  it("returns a product to every tenant role", async () => {
    const p = await makeProduct(t.a.organizationId, "A1");
    for (const role of ["OWNER", "WAREHOUSE_ADMIN", "VIEWER"] as const) {
      expect((await get(p.id, role)).status).toBe(200);
    }
  });

  it("returns 404 for another organization's product and for a malformed id", async () => {
    const foreign = await makeProduct(t.b.organizationId, "B1");
    expect((await get(foreign.id)).status).toBe(404);
    expect((await get("not-a-uuid")).status).toBe(404);
  });

  it("returns an archived product to the owner but 404 to other roles", async () => {
    const p = await makeProduct(t.a.organizationId, "OLD", new Date());
    expect((await get(p.id)).status).toBe(200);
    expect((await get(p.id, "VIEWER")).status).toBe(404);
    expect((await get(p.id, "WAREHOUSE_ADMIN")).status).toBe(404);
  });
});

describe("PATCH /api/products/:id", () => {
  it("updates sku (normalised), name, unit and minStock", async () => {
    const p = await makeProduct(t.a.organizationId, "A1");
    const res = await patch(p.id, { sku: "n ew-1", name: "Baru", unit: "btl", minStock: 7 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      sku: "NEW-1",
      name: "Baru",
      unit: "btl",
      minStock: 7,
    });
  });

  it("returns 409 when the SKU belongs to another product of the organization", async () => {
    await makeProduct(t.a.organizationId, "TAKEN");
    const p = await makeProduct(t.a.organizationId, "A1");
    expect((await patch(p.id, { sku: "taken" })).status).toBe(409);
  });

  it("returns 400 for an empty body, a bad unit or a non-boolean archived", async () => {
    const p = await makeProduct(t.a.organizationId, "A1");
    expect((await patch(p.id, {})).status).toBe(400);
    expect((await patch(p.id, { unit: "kg" })).status).toBe(400);
    expect((await patch(p.id, { archived: "yes" })).status).toBe(400);
  });

  it("returns 403 for a Warehouse Admin and a Viewer, data unchanged", async () => {
    const p = await makeProduct(t.a.organizationId, "A1");
    expect((await patch(p.id, { name: "x" }, "WAREHOUSE_ADMIN")).status).toBe(403);
    expect((await patch(p.id, { name: "x" }, "VIEWER")).status).toBe(403);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).name).toBe("A1");
  });

  it("returns 404 and changes nothing for another organization's product", async () => {
    const foreign = await makeProduct(t.b.organizationId, "B1");
    expect((await patch(foreign.id, { name: "x" })).status).toBe(404);
    expect((await patch(foreign.id, { archived: true })).status).toBe(404);
    const row = await prisma.product.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(row).toMatchObject({ name: "B1", archivedAt: null });
  });
});

describe("PATCH /api/products/:id archive and restore (BL09)", () => {
  it("archives a product, also one that still has stock", async () => {
    const p = await makeProduct(t.a.organizationId, "A1");
    await prisma.stockLevel.create({
      data: {
        organizationId: t.a.organizationId,
        warehouseId: t.a.warehouseId,
        productId: p.id,
        quantity: 4,
      },
    });
    const res = await patch(p.id, { archived: true });
    expect(res.status).toBe(200);
    expect((await res.json()).archivedAt).not.toBeNull();
    expect(await archivedAt(p.id)).not.toBeNull();
  });

  it("restores an archived product", async () => {
    const p = await makeProduct(t.a.organizationId, "OLD", new Date());
    const res = await patch(p.id, { archived: false });
    expect(res.status).toBe(200);
    expect((await res.json()).archivedAt).toBeNull();
    expect(await archivedAt(p.id)).toBeNull();
  });

  it("does not restore or archive a foreign product (404, archivedAt unchanged)", async () => {
    const old = await makeProduct(t.b.organizationId, "OLD", new Date());
    const active = await makeProduct(t.b.organizationId, "ACT");
    expect((await patch(old.id, { archived: false })).status).toBe(404);
    expect((await patch(active.id, { archived: true })).status).toBe(404);
    expect(await archivedAt(old.id)).not.toBeNull();
    expect(await archivedAt(active.id)).toBeNull();
  });

  it("does not edit fields of an archived product without restoring it", async () => {
    const p = await makeProduct(t.a.organizationId, "OLD", new Date());
    expect((await patch(p.id, { name: "x" })).status).toBe(404);
  });

  it("returns 403 for non-owners trying to archive or restore", async () => {
    const p = await makeProduct(t.a.organizationId, "OLD", new Date());
    expect((await patch(p.id, { archived: false }, "WAREHOUSE_ADMIN")).status).toBe(403);
    expect((await patch(p.id, { archived: false }, "VIEWER")).status).toBe(403);
    expect(await archivedAt(p.id)).not.toBeNull();
  });
});
