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
import * as route from "../../app/api/stock/movements/route";
import * as itemRoute from "../../app/api/stock/movements/[id]/route";
import { decodeMovementCursor, encodeMovementCursor } from "./stock-schema";

// BL16: filters, keyset pagination, warehouse scope.
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

async function get(role: "OWNER" | "WAREHOUSE_ADMIN" | "VIEWER", query = "") {
  const reply = await callRoute(route.GET, {
    method: "GET",
    path: `/api/stock/movements${query}`,
    cookie: await cookieFor(t.a.users[role]),
  });
  return { status: reply.status, json: await reply.json() };
}

// n rows one second apart (the oldest first), all in A's warehouse unless overridden.
async function seedRows(n: number, extra: Record<string, unknown> = {}) {
  const base = Date.now() - 1_000_000;
  const data = Array.from({ length: n }, (_, i) => ({
    organizationId: t.a.organizationId,
    warehouseId: t.a.warehouseId,
    productId: t.a.productId,
    quantityDelta: 1,
    type: "RECEIVE" as const,
    createdById: t.a.users.OWNER,
    createdAt: new Date(base + i * 1000),
    ...extra,
  }));
  await prisma.stockMovement.createMany({ data });
}

describe("GET /api/stock/movements", () => {
  it("pages newest first with a cursor and no overlap", async () => {
    await seedRows(120);
    const first = await get("OWNER");
    expect(first.json.items).toHaveLength(50);
    expect(first.json.nextCursor).toBeTypeOf("string");
    const second = await get("OWNER", `?cursor=${first.json.nextCursor}`);
    const third = await get("OWNER", `?cursor=${second.json.nextCursor}`);
    expect(third.json.items).toHaveLength(20);
    expect(third.json.nextCursor).toBeNull();
    const ids = [...first.json.items, ...second.json.items, ...third.json.items].map(
      (r: { id: string }) => r.id,
    );
    expect(new Set(ids).size).toBe(120);
    const times = [...first.json.items, ...second.json.items, ...third.json.items].map(
      (r: { createdAt: string }) => r.createdAt,
    );
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("does not skip rows that share one createdAt", async () => {
    const same = new Date(Date.now() - 5000);
    await seedRows(60, { createdAt: same });
    const first = await get("OWNER");
    const second = await get("OWNER", `?cursor=${first.json.nextCursor}`);
    expect(first.json.items.length + second.json.items.length).toBe(60);
    expect(second.json.nextCursor).toBeNull();
  });

  it("filters by type, product, creator and date range", async () => {
    await seedRows(3);
    await seedRows(2, {
      type: "ADJUST",
      reason: "CORRECTION",
      createdById: t.a.users.WAREHOUSE_ADMIN,
    });
    expect((await get("OWNER", "?type=ADJUST")).json.items).toHaveLength(2);
    expect(
      (await get("OWNER", `?createdById=${t.a.users.WAREHOUSE_ADMIN}`)).json.items,
    ).toHaveLength(2);
    expect((await get("OWNER", `?productId=${t.a.productId}`)).json.items).toHaveLength(5);
    const future = encodeURIComponent(new Date(Date.now() + 60_000).toISOString());
    expect((await get("OWNER", `?from=${future}`)).json.items).toHaveLength(0);
    expect((await get("OWNER", `?to=${future}`)).json.items).toHaveLength(5);
  });

  it("shows a non-owner only assigned warehouses", async () => {
    await seedRows(2);
    const other = await prisma.warehouse.create({
      data: {
        organizationId: t.a.organizationId,
        code: t.unique("OTH").toUpperCase(),
        name: "Other",
      },
    });
    await seedRows(3, { warehouseId: other.id });
    const owner = await get("OWNER");
    expect(owner.json.items).toHaveLength(5);
    const viewer = await get("VIEWER");
    expect(viewer.json.items).toHaveLength(2);
    // Asking for a warehouse outside the scope matches nothing instead of failing.
    expect((await get("VIEWER", `?warehouseId=${other.id}`)).json.items).toHaveLength(0);
  });

  it("answers 400 for a malformed cursor, type or date", async () => {
    for (const q of ["?cursor=abc", "?type=NOPE", "?from=yesterday", "?productId=1"]) {
      const reply = await get("OWNER", q);
      expect(reply.status).toBe(400);
      expect(reply.json.code).toBe("VALIDATION_ERROR");
    }
  });

  it("cursor round trips", () => {
    const cursor = { createdAt: new Date("2026-10-27T01:02:03.456Z"), id: crypto.randomUUID() };
    expect(decodeMovementCursor(encodeMovementCursor(cursor))).toEqual(cursor);
  });
});

// BL16 "stays fast with 10,000+ rows": the numbers go in the PR. No time limit is asserted (a shared
// CI machine makes one flaky); the plan check proves the composite index is what serves the page.
describe("GET /api/stock/movements/[id]", () => {
  async function getOne(role: "OWNER" | "WAREHOUSE_ADMIN" | "VIEWER", id: string) {
    const reply = await callRoute(itemRoute.GET, {
      method: "GET",
      path: `/api/stock/movements/${id}`,
      cookie: await cookieFor(t.a.users[role]),
      params: { id },
    });
    return { status: reply.status, json: await reply.json() };
  }

  it("returns the row with its names, creator and transfer", async () => {
    const destination = await prisma.warehouse.create({
      data: { organizationId: t.a.organizationId, code: "DST", name: "Tujuan" },
    });
    const transfer = await prisma.stockTransfer.create({
      data: {
        organizationId: t.a.organizationId,
        code: "MT-0001",
        fromWarehouseId: t.a.warehouseId,
        toWarehouseId: destination.id,
        createdById: t.a.users.OWNER,
      },
    });
    const row = await prisma.stockMovement.create({
      data: {
        organizationId: t.a.organizationId,
        warehouseId: t.a.warehouseId,
        productId: t.a.productId,
        quantityDelta: -3,
        type: "TRANSFER_OUT",
        transferId: transfer.id,
        note: "catatan",
        createdById: t.a.users.OWNER,
      },
    });
    const { status, json } = await getOne("VIEWER", row.id);
    expect(status).toBe(200);
    expect(json).toMatchObject({
      id: row.id,
      quantityDelta: -3,
      type: "TRANSFER_OUT",
      note: "catatan",
      warehouse: { id: t.a.warehouseId },
      product: { id: t.a.productId },
      createdBy: { id: t.a.users.OWNER, role: "OWNER" },
      transfer: {
        id: transfer.id,
        code: "MT-0001",
        toWarehouse: { id: destination.id, name: "Tujuan" },
      },
    });
    expect(json.createdBy).not.toHaveProperty("email");
  });

  it("answers 404 for another organization, an unknown id and a malformed id", async () => {
    const other = await prisma.stockMovement.create({
      data: {
        organizationId: t.b.organizationId,
        warehouseId: t.b.warehouseId,
        productId: t.b.productId,
        quantityDelta: 1,
        type: "RECEIVE",
        createdById: t.b.users.OWNER,
      },
    });
    for (const id of [other.id, "00000000-0000-7000-8000-00000000ffff", "nope"]) {
      expect((await getOne("OWNER", id)).status).toBe(404);
    }
  });

  it("answers 404 for a warehouse the user is not assigned to", async () => {
    const hidden = await prisma.warehouse.create({
      data: { organizationId: t.a.organizationId, code: "HID", name: "Hidden" },
    });
    const row = await prisma.stockMovement.create({
      data: {
        organizationId: t.a.organizationId,
        warehouseId: hidden.id,
        productId: t.a.productId,
        quantityDelta: 1,
        type: "RECEIVE",
        createdById: t.a.users.OWNER,
      },
    });
    expect((await getOne("VIEWER", row.id)).status).toBe(404);
    expect((await getOne("OWNER", row.id)).status).toBe(200);
  });
});

describe("history with 10,000 rows", () => {
  it("serves a page from the (organization, createdAt, id) index and reports timings", async () => {
    await prisma.$executeRaw`
      INSERT INTO stock_movements (organization_id, warehouse_id, product_id, quantity_delta, type, created_by_id, created_at)
      SELECT ${t.a.organizationId}::uuid, ${t.a.warehouseId}::uuid, ${t.a.productId}::uuid, 1, 'RECEIVE',
             ${t.a.users.OWNER}::uuid, now() - (g || ' seconds')::interval
      FROM generate_series(1, 10000) AS g`;
    await prisma.$executeRaw`ANALYZE stock_movements`;
    const timings: number[] = [];
    let cursor = "";
    for (let page = 0; page < 5; page++) {
      const started = performance.now();
      const reply = await get("OWNER", cursor ? `?cursor=${cursor}` : "");
      timings.push(Math.round(performance.now() - started));
      expect(reply.json.items).toHaveLength(50);
      cursor = reply.json.nextCursor;
    }
    process.stderr.write(
      `E4-07 history timings ms (first page, then pages 2-5): ${timings.join(", ")}` + "\n",
    );
    const plan = await prisma.$queryRaw<{ "QUERY PLAN": string }[]>`
      EXPLAIN SELECT id FROM stock_movements WHERE organization_id = ${t.a.organizationId}::uuid
      ORDER BY created_at DESC, id DESC LIMIT 51`;
    expect(plan.map((row) => row["QUERY PLAN"]).join("\n")).toContain(
      "stock_movements_organization_id_created_at_id_idx",
    );
  });
});
