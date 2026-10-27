import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import { env } from "../../lib/env";
import { assertTestDatabaseUrl, createTestPrisma } from "../../test/test-database";
import {
  callRoute,
  cookieFor,
  createTwoTenants,
  type TwoTenants,
} from "../../test/tenant-isolation/fixtures";
import * as route from "../../app/api/dashboard/route";
import { wibDayStart } from "./dashboard-service";

// E6-01: figures, restock ordering, recent activity and warehouse scope of GET /api/dashboard.
let prisma: PrismaClient;
let t: TwoTenants;
let w1: string;
let w2: string;

beforeAll(() => {
  prisma = createTestPrisma(assertTestDatabaseUrl(env.TEST_DATABASE_URL));
});
afterAll(() => prisma.$disconnect());
afterEach(() => vi.useRealTimers());
beforeEach(async () => {
  // Freeze Date at the current instant: "today in WIB" is then the same for the test and the route, even if
  // the run crosses 00:00 WIB. Only Date is faked, so database timeouts keep working.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date() });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  t = await createTwoTenants(prisma);
  w1 = t.a.warehouseId;
  w2 = (
    await prisma.warehouse.findFirstOrThrow({
      where: { organizationId: t.a.organizationId, code: "W2" },
    })
  ).id;
});

async function get(role: "OWNER" | "WAREHOUSE_ADMIN" | "VIEWER") {
  const reply = await callRoute(route.GET, {
    method: "GET",
    path: "/api/dashboard",
    cookie: await cookieFor(t.a.users[role]),
  });
  return { status: reply.status, json: await reply.json() };
}

let sku = 0;
async function stocked(warehouseId: string, minStock: number, quantity: number, archived = false) {
  sku++;
  const product = await prisma.product.create({
    data: {
      organizationId: t.a.organizationId,
      sku: `D-${String(sku).padStart(3, "0")}`,
      name: `Dash ${String(sku).padStart(3, "0")}`,
      unit: "pcs",
      minStock,
      archivedAt: archived ? new Date() : null,
    },
  });
  await prisma.stockLevel.create({
    data: { organizationId: t.a.organizationId, warehouseId, productId: product.id, quantity },
  });
  return product;
}

const movement = (warehouseId: string, productId: string, createdAt: Date) =>
  prisma.stockMovement.create({
    data: {
      organizationId: t.a.organizationId,
      warehouseId,
      productId,
      quantityDelta: 1,
      type: "RECEIVE",
      createdById: t.a.users.OWNER,
      createdAt,
    },
  });

describe("wibDayStart", () => {
  it("returns 00:00 WIB of the current WIB calendar day, in UTC", () => {
    // 23:30 UTC on the 26th is 06:30 WIB on the 27th.
    expect(wibDayStart(new Date("2026-10-26T23:30:00Z")).toISOString()).toBe(
      "2026-10-26T17:00:00.000Z",
    );
    // 16:59 UTC is still the same WIB day as 00:00 UTC.
    expect(wibDayStart(new Date("2026-10-26T16:59:00Z")).toISOString()).toBe(
      "2026-10-25T17:00:00.000Z",
    );
  });
});

describe("GET /api/dashboard", () => {
  it("is empty and zero for an organization without stock", async () => {
    const { status, json } = await get("OWNER");
    expect(status).toBe(200);
    expect(json.summary).toEqual({
      totalProducts: 1,
      totalUnits: 0,
      lowCount: 0,
      outCount: 0,
      movementsToday: 0,
    });
    expect(json.restock).toEqual({ items: [], total: 0 });
    expect(json.recentActivity).toEqual([]);
  });

  it("counts units, low and out, and ignores archived products and the other organization", async () => {
    await stocked(w1, 5, 0); // OUT
    await stocked(w1, 5, 2); // LOW
    await stocked(w2, 5, 9); // OK
    await stocked(w1, 5, 0, true); // archived, never counted as OUT
    // Organization B has an OUT product, stock and a movement today; none of it may show up for A.
    const other = await prisma.product.create({
      data: {
        organizationId: t.b.organizationId,
        sku: "B-001",
        name: "Other org",
        unit: "pcs",
        minStock: 5,
      },
    });
    await prisma.stockLevel.create({
      data: {
        organizationId: t.b.organizationId,
        warehouseId: t.b.warehouseId,
        productId: other.id,
        quantity: 0,
      },
    });
    await prisma.stockMovement.create({
      data: {
        organizationId: t.b.organizationId,
        warehouseId: t.b.warehouseId,
        productId: other.id,
        quantityDelta: 1,
        type: "RECEIVE",
        createdById: t.b.users.OWNER,
      },
    });
    const { json } = await get("OWNER");
    expect(json.summary).toMatchObject({
      totalProducts: 4,
      totalUnits: 11,
      lowCount: 1,
      outCount: 1,
      movementsToday: 0,
    });
    expect(json.restock.total).toBe(2);
    expect(json.recentActivity).toEqual([]);
  });

  it("lists the 5 lowest items by stock minus minimum, ties by ids", async () => {
    await stocked(w1, 100, 0); // -100
    await stocked(w1, 10, 0); // -10
    await stocked(w1, 50, 30); // -20
    await stocked(w2, 4, 3); // -1
    await stocked(w2, 40, 1); // -39
    await stocked(w2, 6, 5); // -1
    await stocked(w2, 6, 6); // OK, never listed
    const { json } = await get("OWNER");
    const diffs = json.restock.items.map(
      (i: { quantity: number; product: { minStock: number } }) => i.quantity - i.product.minStock,
    );
    expect(diffs).toEqual([-100, -39, -20, -10, -1]);
    expect(json.restock.total).toBe(6);
    expect(json.restock.items[0]).toMatchObject({
      status: "OUT",
      warehouse: { id: w1 },
      product: { minStock: 100, unit: "pcs" },
    });
  });

  it("counts movements since 00:00 WIB and shows the 5 latest", async () => {
    const p = await stocked(w1, 0, 1);
    const start = wibDayStart(new Date());
    const nextDay = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    await movement(w1, p.id, new Date(start.getTime() - 1000)); // yesterday in WIB
    await movement(w1, p.id, nextDay); // 00:00 WIB tomorrow: the upper bound is exclusive
    for (let i = 0; i < 6; i++) await movement(w1, p.id, new Date(start.getTime() + i * 1000));
    const { json } = await get("OWNER");
    expect(json.summary.movementsToday).toBe(6);
    expect(json.recentActivity).toHaveLength(5);
    const times = json.recentActivity.map((a: { createdAt: string }) => a.createdAt);
    expect(times).toEqual([...times].sort().reverse());
    expect(json.recentActivity[0]).toMatchObject({
      type: "RECEIVE",
      quantityDelta: 1,
      warehouse: { id: w1 },
      product: { id: p.id },
      createdBy: { id: t.a.users.OWNER },
    });
  });

  it("computes everything only from the assigned warehouses", async () => {
    const p1 = await stocked(w1, 5, 1);
    const p2 = await stocked(w2, 5, 0);
    await movement(w1, p1.id, new Date());
    await movement(w2, p2.id, new Date());
    const admin = (await get("WAREHOUSE_ADMIN")).json;
    expect(admin.summary).toMatchObject({ totalUnits: 1, lowCount: 1, outCount: 0 });
    expect(admin.summary.movementsToday).toBe(1);
    expect(admin.restock.total).toBe(1);
    expect(admin.recentActivity).toHaveLength(1);
    expect(admin.recentActivity[0].warehouse.id).toBe(w1);
    const owner = (await get("OWNER")).json;
    expect(owner.summary).toMatchObject({ totalUnits: 1, lowCount: 1, outCount: 1 });
    expect(owner.recentActivity).toHaveLength(2);
  });

  it("gives a viewer the same scoped figures", async () => {
    const p1 = await stocked(w1, 5, 1);
    const p2 = await stocked(w2, 5, 0);
    await movement(w1, p1.id, new Date());
    await movement(w2, p2.id, new Date());
    const viewer = await get("VIEWER");
    expect(viewer.status).toBe(200);
    expect(viewer.json.summary.totalUnits).toBeLessThanOrEqual(1);
    expect(viewer.json.recentActivity.length).toBeLessThanOrEqual(1);
    for (const a of viewer.json.recentActivity) expect(a.warehouse.id).toBe(w1);
  });
});
