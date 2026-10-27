import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import { env } from "../../lib/env";
import { assertTestDatabaseUrl, createTestPrisma } from "../../test/test-database";
import {
  callRoute,
  cookieFor,
  createTwoTenants,
  type TwoTenants,
} from "../../test/tenant-isolation/fixtures";
import * as route from "../../app/api/stock/route";
import { stockStatusOf } from "./stock-status";

// E4-06: statuses, summary, scope, archived rows, pagination of GET /api/stock.
let prisma: PrismaClient;
let t: TwoTenants;
let w1: string;
let w2: string;

beforeAll(() => {
  prisma = createTestPrisma(assertTestDatabaseUrl(env.TEST_DATABASE_URL));
});
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  t = await createTwoTenants(prisma);
  w1 = t.a.warehouseId;
  // The second warehouse of A is assigned to nobody except the Owner (who sees all).
  w2 = (
    await prisma.warehouse.findFirstOrThrow({
      where: { organizationId: t.a.organizationId, code: "W2" },
    })
  ).id;
});

async function get(role: "OWNER" | "WAREHOUSE_ADMIN" | "VIEWER", query = "") {
  const reply = await callRoute(route.GET, {
    method: "GET",
    path: `/api/stock${query}`,
    cookie: await cookieFor(t.a.users[role]),
  });
  return { status: reply.status, json: await reply.json() };
}

let sku = 0;
async function product(minStock: number, extra: Record<string, unknown> = {}) {
  sku++;
  return prisma.product.create({
    data: {
      organizationId: t.a.organizationId,
      sku: `P-${String(sku).padStart(3, "0")}`,
      name: `Product ${String(sku).padStart(3, "0")}`,
      unit: "pcs",
      minStock,
      ...extra,
    },
  });
}
const level = (warehouseId: string, productId: string, quantity: number) =>
  prisma.stockLevel.create({
    data: { organizationId: t.a.organizationId, warehouseId, productId, quantity },
  });

describe("GET /api/stock status", () => {
  it("classifies the boundaries of minStock 5", async () => {
    for (const quantity of [0, 1, 4, 5, 6]) await level(w1, (await product(5)).id, quantity);
    const { json } = await get("OWNER");
    const byQuantity = Object.fromEntries(
      json.items.map((i: { quantity: number; status: string }) => [i.quantity, i.status]),
    );
    expect(byQuantity).toEqual({ 0: "OUT", 1: "LOW", 4: "LOW", 5: "OK", 6: "OK" });
    expect(json.summary).toEqual({ out: 1, low: 2, ok: 2 });
    expect(json.total).toBe(5);
  });

  it("never marks minStock 0 or 1 as LOW", async () => {
    for (const minStock of [0, 1]) {
      for (const quantity of [0, 1, 2]) await level(w1, (await product(minStock)).id, quantity);
    }
    const { json } = await get("OWNER");
    expect(json.summary).toEqual({ out: 2, low: 0, ok: 4 });
    expect((await get("OWNER", "?status=LOW")).json.items).toEqual([]);
  });

  it("filters by status with a matching total", async () => {
    await level(w1, (await product(3)).id, 0);
    await level(w1, (await product(3)).id, 2);
    await level(w1, (await product(3)).id, 3);
    const low = (await get("OWNER", "?status=LOW")).json;
    expect(low.items.map((i: { quantity: number }) => i.quantity)).toEqual([2]);
    expect(low.total).toBe(1);
    // The summary ignores the status filter, so the chips keep their numbers.
    expect(low.summary).toEqual({ out: 1, low: 1, ok: 1 });
  });

  it("matches a brute-force computation on random data", async () => {
    let seed = 42;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const rows: { quantity: number; minStock: number }[] = [];
    for (let i = 0; i < 40; i++) {
      const minStock = random(7);
      const quantity = random(9);
      rows.push({ quantity, minStock });
      await level(i % 2 ? w1 : w2, (await product(minStock)).id, quantity);
    }
    for (const status of ["OUT", "LOW", "OK"] as const) {
      const expected = rows.filter((r) => stockStatusOf(r.quantity, r.minStock) === status).length;
      const { json } = await get("OWNER", `?status=${status}&pageSize=100`);
      expect(json.total).toBe(expected);
      expect(json.items).toHaveLength(expected);
      expect(json.items.every((i: { status: string }) => i.status === status)).toBe(true);
      expect(json.summary[status.toLowerCase()]).toBe(expected);
    }
    const all = (await get("OWNER", "?pageSize=100")).json;
    expect(all.summary.out + all.summary.low + all.summary.ok).toBe(all.total);
    expect(all.total).toBe(40);
  });
});

describe("GET /api/stock scope and filters", () => {
  it("shows a Warehouse Admin only the assigned warehouses", async () => {
    const p = await product(0);
    await level(w1, p.id, 3);
    await level(w2, p.id, 9);
    const admin = await get("WAREHOUSE_ADMIN");
    expect(admin.json.items.map((i: { warehouse: { id: string } }) => i.warehouse.id)).toEqual([
      w1,
    ]);
    expect(admin.json.summary).toEqual({ out: 0, low: 0, ok: 1 });
    expect((await get("OWNER")).json.total).toBe(2);
  });

  it("answers 403 for an unassigned or unknown warehouse, with the same body", async () => {
    const foreign = await get("WAREHOUSE_ADMIN", `?warehouseId=${w2}`);
    const missing = await get(
      "WAREHOUSE_ADMIN",
      "?warehouseId=00000000-0000-7000-8000-000000000009",
    );
    expect(foreign.status).toBe(403);
    expect(foreign.json).toEqual(missing.json);
  });

  it("gives an empty list for a foreign or unknown productId", async () => {
    await level(w1, (await product(0)).id, 3);
    const foreign = await get("OWNER", `?productId=${t.b.productId}`);
    expect(foreign.status).toBe(200);
    expect(foreign.json.items).toEqual([]);
    expect(foreign.json.total).toBe(0);
  });

  it("searches sku and name case-insensitively", async () => {
    const a = await product(0, { sku: "KOPI-1", name: "Biji Arabika" });
    const b = await product(0, { sku: "GULA-1", name: "Gula Aren" });
    await level(w1, a.id, 1);
    await level(w1, b.id, 1);
    expect((await get("OWNER", "?q=kopi")).json.items).toHaveLength(1);
    expect((await get("OWNER", "?q=AREN")).json.items[0].product.sku).toBe("GULA-1");
  });

  it("shows an archived product only while it has stock, marked archived", async () => {
    const withStock = await product(0, { archivedAt: new Date() });
    const empty = await product(0, { archivedAt: new Date() });
    await level(w1, withStock.id, 4);
    await level(w1, empty.id, 0);
    const { json } = await get("OWNER");
    expect(json.items).toHaveLength(1);
    expect(json.items[0].product).toMatchObject({ id: withStock.id, archived: true });
    expect(json.summary).toEqual({ out: 0, low: 0, ok: 1 });
  });

  it("does not return a pair without a stock row", async () => {
    await product(5);
    expect((await get("OWNER")).json.total).toBe(0);
  });

  it("pages in a stable order without overlap", async () => {
    for (let i = 0; i < 7; i++)
      await level(i % 2 ? w1 : w2, (await product(0, { name: "Same name" })).id, i + 1);
    const seen: string[] = [];
    for (const page of [1, 2, 3, 4]) {
      const { json } = await get("OWNER", `?pageSize=2&page=${page}`);
      expect(json.total).toBe(7);
      seen.push(...json.items.map((i: { product: { id: string } }) => i.product.id));
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect(
      (await get("OWNER", "?pageSize=2&page=1")).json.items.map(
        (i: { product: { id: string } }) => i.product.id,
      ),
    ).toEqual(seen.slice(0, 2));
  });

  it("rejects pageSize above 100", async () => {
    expect((await get("OWNER", "?pageSize=101")).status).toBe(400);
  });
});
