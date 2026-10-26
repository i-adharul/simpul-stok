import { randomUUID } from "node:crypto";
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
import * as receiveRoute from "../../app/api/stock/receive/route";
import type { RequestContext } from "../platform/request-context";
import { createTenantClient } from "../platform/tenant-client";
import { receiveStock } from "./stock-service";
import { updateWarehouse } from "./warehouse-service";
import { lockWarehouse } from "./warehouse-lock";

// BL11, BL14, BL15 and the BL08 invariant. Route-level tests go through the exported handler (one
// request at a time; the route module has its own small pool). Concurrency tests call the services
// with a client from a pool of 25, so 20 transactions can wait on one row lock.

const INT_MAX = 2_147_483_647;
const TX_POOL = 25;

let prisma: PrismaClient;
let pool: PrismaClient;
let t: TwoTenants;

beforeAll(() => {
  const url = assertTestDatabaseUrl(env.TEST_DATABASE_URL);
  prisma = createTestPrisma(url);
  pool = createTestPrisma(url, { max: TX_POOL });
});
afterAll(async () => {
  await prisma.$disconnect();
  await pool.$disconnect();
});
beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  t = await createTwoTenants(prisma);
});

type Role = "OWNER" | "WAREHOUSE_ADMIN" | "VIEWER";

async function receive(
  role: Role,
  body: unknown,
  options: { key?: string | null } = {},
): Promise<Response> {
  const key = options.key === undefined ? randomUUID() : options.key;
  return callRoute(receiveRoute.POST, {
    method: "POST",
    path: "/api/stock/receive",
    cookie: await cookieFor(t.a.users[role]),
    headers: key ? { "Idempotency-Key": key } : undefined,
    body,
  });
}

const valid = (extra: Record<string, unknown> = {}) => ({
  warehouseId: t.a.warehouseId,
  productId: t.a.productId,
  quantity: 5,
  ...extra,
});

const levelOf = async (warehouseId = t.a.warehouseId, productId = t.a.productId) =>
  (
    await prisma.stockLevel.findUnique({
      where: { warehouseId_productId: { warehouseId, productId } },
    })
  )?.quantity ?? null;
const movementCount = () =>
  prisma.stockMovement.count({ where: { organizationId: t.a.organizationId } });

// A context for the service-level tests: the Owner of A with every active warehouse of A.
async function ownerContext(): Promise<RequestContext> {
  const warehouses = await prisma.warehouse.findMany({
    where: { organizationId: t.a.organizationId, archivedAt: null },
    select: { id: true },
  });
  return {
    userId: t.a.users.OWNER,
    organizationId: t.a.organizationId,
    role: "OWNER",
    warehouseIds: warehouses.map((w) => w.id),
  };
}

describe("POST /api/stock/receive", () => {
  it("creates the StockLevel row on the first receipt and answers with the movement only", async () => {
    expect(await levelOf()).toBeNull();
    const res = await receive("OWNER", valid());
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(Object.keys(json).sort()).toEqual(
      ["createdAt", "id", "productId", "quantity", "warehouseId"].sort(),
    );
    expect(json).toMatchObject({
      warehouseId: t.a.warehouseId,
      productId: t.a.productId,
      quantity: 5,
    });
    expect(await levelOf()).toBe(5);
    const movement = await prisma.stockMovement.findUniqueOrThrow({ where: { id: json.id } });
    expect(movement).toMatchObject({
      type: "RECEIVE",
      quantityDelta: 5,
      createdById: t.a.users.OWNER,
      organizationId: t.a.organizationId,
    });
  });

  it("adds to an existing StockLevel row and keeps one row per pair", async () => {
    await receive("OWNER", valid({ quantity: 5 }));
    await receive("OWNER", valid({ quantity: 7 }));
    expect(await levelOf()).toBe(12);
    expect(await prisma.stockLevel.count({ where: { organizationId: t.a.organizationId } })).toBe(
      1,
    );
    expect(await movementCount()).toBe(2);
  });

  it("stores the trimmed note on the movement, and null when it is empty", async () => {
    const withNote = await (await receive("OWNER", valid({ note: "  PO-123  " }))).json();
    const without = await (await receive("OWNER", valid({ note: "   " }))).json();
    const rows = await prisma.stockMovement.findMany({
      where: { id: { in: [withNote.id, without.id] } },
    });
    expect(rows.find((r) => r.id === withNote.id)?.note).toBe("PO-123");
    expect(rows.find((r) => r.id === without.id)?.note).toBeNull();
  });

  it("accepts a note of 255 characters and rejects 256 with 400", async () => {
    expect((await receive("OWNER", valid({ note: "n".repeat(255) }))).status).toBe(201);
    const tooLong = await receive("OWNER", valid({ note: "n".repeat(256) }));
    expect(tooLong.status).toBe(400);
    expect(await movementCount()).toBe(1);
  });

  it("lets a Warehouse Admin receive into an assigned warehouse", async () => {
    const res = await receive("WAREHOUSE_ADMIN", valid());
    expect(res.status).toBe(201);
  });

  it.each([0, -1, 1_000_001, 1.5, "5", null])("rejects quantity %j with 400", async (quantity) => {
    const res = await receive("OWNER", valid({ quantity }));
    expect(res.status).toBe(400);
    expect(await levelOf()).toBeNull();
    expect(await movementCount()).toBe(0);
  });

  it.each([1, 1_000_000])("accepts the boundary quantity %d", async (quantity) => {
    expect((await receive("OWNER", valid({ quantity }))).status).toBe(201);
    expect(await levelOf()).toBe(quantity);
  });

  it("rejects organizationId and unknown fields in the body", async () => {
    const res = await receive("OWNER", valid({ organizationId: t.b.organizationId }));
    expect(res.status).toBe(400);
    expect(await movementCount()).toBe(0);
  });

  it("answers 400 without a valid Idempotency-Key and writes nothing", async () => {
    expect((await receive("OWNER", valid(), { key: null })).status).toBe(400);
    expect((await receive("OWNER", valid(), { key: "nope" })).status).toBe(400);
    expect(await movementCount()).toBe(0);
  });

  it("gives a Viewer 403 and writes nothing", async () => {
    const res = await receive("VIEWER", valid());
    expect(res.status).toBe(403);
    expect(await movementCount()).toBe(0);
  });

  it("gives a Warehouse Admin 403 for a warehouse that is not assigned", async () => {
    const other = await prisma.warehouse.findFirstOrThrow({
      where: { organizationId: t.a.organizationId, id: { not: t.a.warehouseId } },
    });
    const res = await receive("WAREHOUSE_ADMIN", valid({ warehouseId: other.id }));
    expect(res.status).toBe(403);
    expect(await movementCount()).toBe(0);
  });

  it("gives 403 for a warehouse that was archived before the request (not in ctx.warehouseIds)", async () => {
    await prisma.warehouse.update({
      where: { id: t.a.warehouseId },
      data: { archivedAt: new Date() },
    });
    const res = await receive("OWNER", valid());
    expect(res.status).toBe(403);
    expect(await movementCount()).toBe(0);
  });

  it("gives 409 CONFLICT for an archived product and writes nothing", async () => {
    await prisma.product.update({ where: { id: t.a.productId }, data: { archivedAt: new Date() } });
    const res = await receive("OWNER", valid());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "CONFLICT" });
    expect(await levelOf()).toBeNull();
    expect(await movementCount()).toBe(0);
  });

  it("gives the same 403 for a warehouse of B and a missing one, and 404 for a product of B", async () => {
    const foreignWarehouse = await receive("OWNER", valid({ warehouseId: t.b.warehouseId }));
    const missingWarehouse = await receive("OWNER", valid({ warehouseId: randomUUID() }));
    expect(foreignWarehouse.status).toBe(403);
    expect(await foreignWarehouse.text()).toBe(await missingWarehouse.text());
    const foreignProduct = await receive("OWNER", valid({ productId: t.b.productId }));
    expect(foreignProduct.status).toBe(404);
    expect(await levelOf(t.b.warehouseId, t.b.productId)).toBeNull();
  });

  it("replays the same key: identical body, replay header, stock added once", async () => {
    const key = randomUUID();
    const first = await receive("OWNER", valid(), { key });
    const second = await receive("OWNER", valid(), { key });
    expect(second.status).toBe(first.status);
    expect(await second.text()).toBe(await first.text());
    expect(first.headers.get("Idempotency-Replayed")).toBeNull();
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await levelOf()).toBe(5);
    expect(await movementCount()).toBe(1);
  });

  it("answers 409 in Indonesian when the quantity would pass the column maximum, and keeps the stock", async () => {
    await prisma.stockLevel.create({
      data: {
        organizationId: t.a.organizationId,
        warehouseId: t.a.warehouseId,
        productId: t.a.productId,
        quantity: INT_MAX - 2,
      },
    });
    const res = await receive("OWNER", valid({ quantity: 5 }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("CONFLICT");
    expect(json.message).toMatch(/melebihi batas/i);
    expect(await levelOf()).toBe(INT_MAX - 2);
    expect(await movementCount()).toBe(0);
    // The edge itself still works.
    expect((await receive("OWNER", valid({ quantity: 2 }))).status).toBe(201);
    expect(await levelOf()).toBe(INT_MAX);
  });
});

describe("receiveStock (service)", () => {
  it("20 parallel receipts into a missing StockLevel row lose no update", async () => {
    const ctx = await ownerContext();
    const db = createTenantClient(pool, ctx);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        receiveStock(db, ctx, randomUUID(), {
          warehouseId: t.a.warehouseId,
          productId: t.a.productId,
          quantity: i + 1,
        }),
      ),
    );
    expect(results.every((r) => !r.replayed)).toBe(true);
    expect(await levelOf()).toBe((20 * 21) / 2);
    expect(await movementCount()).toBe(20);
    expect(await prisma.stockLevel.count({ where: { organizationId: t.a.organizationId } })).toBe(
      1,
    );
  });

  it("answers 409 when the warehouse is archived after the request context was built", async () => {
    const ctx = await ownerContext(); // still lists the warehouse
    await prisma.warehouse.update({
      where: { id: t.a.warehouseId },
      data: { archivedAt: new Date() },
    });
    const db = createTenantClient(pool, ctx);
    await expect(
      receiveStock(db, ctx, randomUUID(), {
        warehouseId: t.a.warehouseId,
        productId: t.a.productId,
        quantity: 1,
      }),
    ).rejects.toMatchObject({ status: 409, code: "CONFLICT" });
    expect(await levelOf()).toBeNull();
    expect(await movementCount()).toBe(0);
  });

  // Deterministic version of the race: a receipt holds the lock and has written stock but not yet
  // committed; the archive must wait for it, then see the stock and answer 409.
  it("archiving waits for a receipt that holds the warehouse lock, then refuses (409)", async () => {
    const ctx = await ownerContext();
    const db = createTenantClient(pool, ctx);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    const holder = db.$transaction(async (tx) => {
      await lockWarehouse(tx, t.a.warehouseId);
      await tx.stockLevel.create({
        data: {
          organizationId: t.a.organizationId,
          warehouseId: t.a.warehouseId,
          productId: t.a.productId,
          quantity: 4,
        },
      });
      locked();
      await gate;
    });
    await lockTaken;
    const archive = updateWarehouse(db, t.a.warehouseId, { archived: true }).then(
      () => 200,
      (e: { status?: number }) => e.status,
    );
    await new Promise((resolve) => setTimeout(resolve, 200)); // the archive is parked on the lock
    release();
    await holder;
    expect(await archive).toBe(409);
    const row = await prisma.warehouse.findUniqueOrThrow({ where: { id: t.a.warehouseId } });
    expect(row.archivedAt).toBeNull();
  });

  // BL08: an archived warehouse never holds stock > 0, whichever side wins the race.
  it("receive vs archive, 20 rounds: an archived warehouse never holds stock", async () => {
    const ctx = await ownerContext();
    const outcomes = { receiveWon: 0, archiveWon: 0 };
    for (let round = 0; round < 20; round++) {
      const warehouse = await prisma.warehouse.create({
        data: { organizationId: t.a.organizationId, code: `R${round}`, name: `Race ${round}` },
      });
      const roundCtx = { ...ctx, warehouseIds: [...ctx.warehouseIds, warehouse.id] };
      const roundDb = createTenantClient(pool, roundCtx);
      const [received, archived] = await Promise.allSettled([
        receiveStock(roundDb, roundCtx, randomUUID(), {
          warehouseId: warehouse.id,
          productId: t.a.productId,
          quantity: 3,
        }),
        updateWarehouse(roundDb, warehouse.id, { archived: true }),
      ]);
      const receiveStatus =
        received.status === "fulfilled" ? 201 : (received.reason as { status?: number }).status;
      const archiveStatus =
        archived.status === "fulfilled" ? 200 : (archived.reason as { status?: number }).status;
      expect([201, 409]).toContain(receiveStatus);
      expect([200, 409]).toContain(archiveStatus);
      // Exactly one of them wins: both succeeding would be an archived warehouse with stock.
      expect(receiveStatus === 201 && archiveStatus === 200).toBe(false);
      const row = await prisma.warehouse.findUniqueOrThrow({ where: { id: warehouse.id } });
      const stock = await prisma.stockLevel.aggregate({
        where: { warehouseId: warehouse.id },
        _sum: { quantity: true },
      });
      if (row.archivedAt !== null) expect(stock._sum.quantity ?? 0).toBe(0);
      if (receiveStatus === 201) outcomes.receiveWon++;
      else outcomes.archiveWon++;
    }
    expect(outcomes.receiveWon + outcomes.archiveWon).toBe(20);
  });
});
