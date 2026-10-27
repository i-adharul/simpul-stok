import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import { env } from "../../lib/env";
import {
  addProduct,
  ownerContextOf,
  quantityOf,
  secondWarehouseId,
  seedLevel,
} from "../../test/stock-fixtures";
import { assertTestDatabaseUrl, createTestPrisma } from "../../test/test-database";
import { createTwoTenants, type TwoTenants } from "../../test/tenant-isolation/fixtures";
import { TRANSACTION_OPTIONS } from "../platform/idempotency";
import type { RequestContext } from "../platform/request-context";
import { createTenantClient } from "../platform/tenant-client";
import { transferStock } from "./stock-transfer-service";

// E5-03 (BL13, BL14). The service rules that the concurrency (E5-01) and atomicity (E5-02) tests do not
// cover. Input shape rules (51 items, duplicates, quantity bounds, same warehouse, organizationId in the
// body) are Zod rules proven in stock-transfer-schema.test.ts; the endpoint answers them with 400 (E5-04).

let prisma: PrismaClient;
let pool: PrismaClient;
let t: TwoTenants;
let source: string;
let destination: string;

beforeAll(() => {
  const url = assertTestDatabaseUrl(env.TEST_DATABASE_URL);
  prisma = createTestPrisma(url);
  pool = createTestPrisma(url, { max: 10 });
});
afterAll(async () => {
  await prisma.$disconnect();
  await pool.$disconnect();
});
beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  t = await createTwoTenants(prisma);
  await prisma.stockTransfer.delete({ where: { id: t.a.transferId } });
  source = t.a.warehouseId;
  destination = await secondWarehouseId(prisma, t);
});

const body = (items: { productId: string; quantity: number }[], overrides = {}) => ({
  fromWarehouseId: source,
  toWarehouseId: destination,
  items,
  ...overrides,
});
const run = async (ctx: RequestContext, key: string, input: ReturnType<typeof body>) =>
  transferStock(createTenantClient(pool, ctx), ctx, key, input);
const counts = async () => ({
  transfers: await prisma.stockTransfer.count({ where: { organizationId: t.a.organizationId } }),
  movements: await prisma.stockMovement.count({ where: { organizationId: t.a.organizationId } }),
  keys: await prisma.idempotencyKey.count({ where: { organizationId: t.a.organizationId } }),
});

describe("transferStock", () => {
  it("moves stock, creates the destination row and writes two movements per item with one transferId", async () => {
    const other = await addProduct(prisma, t, "SKU-2");
    await seedLevel(prisma, t, source, t.a.productId, 10);
    await seedLevel(prisma, t, source, other, 4);
    const ctx = await ownerContextOf(prisma, t);

    const { result, replayed } = await run(
      ctx,
      randomUUID(),
      body(
        [
          { productId: t.a.productId, quantity: 6 },
          { productId: other, quantity: 4 },
        ],
        { note: "Isi ulang" },
      ),
    );

    expect(replayed).toBe(false);
    expect(result).toMatchObject({
      code: "MT-0001",
      fromWarehouseId: source,
      toWarehouseId: destination,
      note: "Isi ulang",
    });
    expect(result.items).toHaveLength(2);
    expect(result).not.toHaveProperty("quantity");
    expect(await quantityOf(prisma, source, t.a.productId)).toBe(4);
    expect(await quantityOf(prisma, source, other)).toBe(0);
    expect(await quantityOf(prisma, destination, t.a.productId)).toBe(6);
    expect(await quantityOf(prisma, destination, other)).toBe(4);
    const movements = await prisma.stockMovement.findMany({ where: { transferId: result.id } });
    expect(movements).toHaveLength(4);
    expect(movements.filter((m) => m.quantityDelta < 0).map((m) => m.type)).toEqual([
      "TRANSFER_OUT",
      "TRANSFER_OUT",
    ]);
  });

  it("numbers transfers MT-0001, MT-0002 in order", async () => {
    await seedLevel(prisma, t, source, t.a.productId, 5);
    const ctx = await ownerContextOf(prisma, t);
    const item = [{ productId: t.a.productId, quantity: 1 }];
    const first = await run(ctx, randomUUID(), body(item));
    const second = await run(ctx, randomUUID(), body(item));
    expect([first.result.code, second.result.code]).toEqual(["MT-0001", "MT-0002"]);
  });

  it("a transfer of 50 items finishes inside the transaction limit and every pair ends correct", async () => {
    const products = await Promise.all(
      Array.from({ length: 50 }, (_, i) => addProduct(prisma, t, `BULK-${i}`)),
    );
    await prisma.stockLevel.createMany({
      data: products.map((productId, i) => ({
        organizationId: t.a.organizationId,
        warehouseId: source,
        productId,
        quantity: 100 + i,
      })),
    });
    const ctx = await ownerContextOf(prisma, t);

    const started = Date.now();
    const { result } = await run(
      ctx,
      randomUUID(),
      body(products.map((productId, i) => ({ productId, quantity: 1 + i }))),
    );
    expect(Date.now() - started).toBeLessThan(TRANSACTION_OPTIONS.timeout);

    expect(result.items).toHaveLength(50);
    for (const [i, productId] of products.entries()) {
      expect(await quantityOf(prisma, source, productId)).toBe(100 + i - (1 + i));
      expect(await quantityOf(prisma, destination, productId)).toBe(1 + i);
    }
    expect((await counts()).movements).toBe(100);
  });

  it("answers 404 for a warehouse or product of another organization and writes nothing", async () => {
    await seedLevel(prisma, t, source, t.a.productId, 5);
    const ctx = await ownerContextOf(prisma, t);
    const item = [{ productId: t.a.productId, quantity: 1 }];
    const cases = [
      body(item, { toWarehouseId: t.b.warehouseId }),
      body(item, { fromWarehouseId: t.b.warehouseId }),
      body([{ productId: t.b.productId, quantity: 1 }]),
    ];
    for (const input of cases) {
      await expect(run(ctx, randomUUID(), input)).rejects.toMatchObject({
        status: 404,
        code: "NOT_FOUND",
      });
    }
    expect(await counts()).toEqual({ transfers: 0, movements: 0, keys: 0 });
    expect(await quantityOf(prisma, source, t.a.productId)).toBe(5);
  });

  it("answers 409 for an archived destination, an archived source and an archived product", async () => {
    await seedLevel(prisma, t, source, t.a.productId, 5);
    const ctx = await ownerContextOf(prisma, t); // built before the archiving, like a request in flight
    const item = [{ productId: t.a.productId, quantity: 1 }];

    await prisma.product.update({ where: { id: t.a.productId }, data: { archivedAt: new Date() } });
    await expect(run(ctx, randomUUID(), body(item))).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
      message: expect.stringContaining("Produk"),
    });
    await prisma.product.update({ where: { id: t.a.productId }, data: { archivedAt: null } });

    await prisma.warehouse.update({ where: { id: destination }, data: { archivedAt: new Date() } });
    await expect(run(ctx, randomUUID(), body(item))).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("tujuan"),
    });
    await prisma.warehouse.update({ where: { id: destination }, data: { archivedAt: null } });

    await prisma.warehouse.update({ where: { id: source }, data: { archivedAt: new Date() } });
    await expect(run(ctx, randomUUID(), body(item))).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("asal"),
    });

    expect(await counts()).toEqual({ transfers: 0, movements: 0, keys: 0 });
    expect(await quantityOf(prisma, source, t.a.productId)).toBe(5);
  });

  // Deterministic retry path, no hook in production code: one existing transfer coded MT-0002 makes the
  // count 1, so the next code is MT-0002 and collides on every attempt until the retries run out.
  it("answers 409 CONFLICT after the code retries are used up and leaves everything unchanged", async () => {
    await prisma.stockTransfer.create({
      data: {
        organizationId: t.a.organizationId,
        code: "MT-0002",
        fromWarehouseId: source,
        toWarehouseId: destination,
        createdById: t.a.users.OWNER,
      },
    });
    await seedLevel(prisma, t, source, t.a.productId, 5);
    await seedLevel(prisma, t, destination, t.a.productId, 2);
    const ctx = await ownerContextOf(prisma, t);

    await expect(
      run(ctx, randomUUID(), body([{ productId: t.a.productId, quantity: 3 }])),
    ).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
      message: "Terlalu banyak mutasi bersamaan, coba lagi.",
    });

    expect(await quantityOf(prisma, source, t.a.productId)).toBe(5);
    expect(await quantityOf(prisma, destination, t.a.productId)).toBe(2);
    expect(await counts()).toEqual({ transfers: 1, movements: 0, keys: 0 });
  });

  it("names the product in INSUFFICIENT_STOCK when the source has no row at all", async () => {
    const ctx = await ownerContextOf(prisma, t);
    await expect(
      run(ctx, randomUUID(), body([{ productId: t.a.productId, quantity: 1 }])),
    ).rejects.toMatchObject({
      status: 409,
      code: "INSUFFICIENT_STOCK",
      details: { productId: t.a.productId },
    });
  });
});

describe("transferStock idempotency (BL14)", () => {
  it("the same key returns the same code and body, and the stock moves once", async () => {
    await seedLevel(prisma, t, source, t.a.productId, 10);
    const ctx = await ownerContextOf(prisma, t);
    const key = randomUUID();
    const input = body([{ productId: t.a.productId, quantity: 3 }]);

    const first = await run(ctx, key, input);
    const again = await run(ctx, key, input);

    expect(first.replayed).toBe(false);
    expect(again.replayed).toBe(true);
    expect(again.result).toEqual(first.result);
    expect(await quantityOf(prisma, source, t.a.productId)).toBe(7);
    expect(await quantityOf(prisma, destination, t.a.productId)).toBe(3);
    expect(await counts()).toEqual({ transfers: 1, movements: 2, keys: 1 });
  });

  it("20 parallel requests with one key move the stock once", async () => {
    await seedLevel(prisma, t, source, t.a.productId, 10);
    const ctx = await ownerContextOf(prisma, t);
    const key = randomUUID();
    const input = body([{ productId: t.a.productId, quantity: 3 }]);
    const results = await Promise.all(Array.from({ length: 20 }, () => run(ctx, key, input)));
    expect(new Set(results.map((r) => r.result.code))).toEqual(new Set(["MT-0001"]));
    expect(await quantityOf(prisma, source, t.a.productId)).toBe(7);
    expect((await counts()).transfers).toBe(1);
  });

  it("refuses a replay by a user who may use the destination but not the source", async () => {
    await seedLevel(prisma, t, destination, t.a.productId, 5);
    const owner = await ownerContextOf(prisma, t);
    const key = randomUUID();
    // The fixture assigns the Warehouse Admin to the first warehouse only.
    const reverse = body([{ productId: t.a.productId, quantity: 2 }], {
      fromWarehouseId: destination,
      toWarehouseId: source,
    });
    await run(owner, key, reverse);

    const admin: RequestContext = {
      userId: t.a.users.WAREHOUSE_ADMIN,
      organizationId: t.a.organizationId,
      role: "WAREHOUSE_ADMIN",
      warehouseIds: [source],
    };
    await expect(run(admin, key, reverse)).rejects.toMatchObject({ status: 404 });
    expect(await quantityOf(prisma, destination, t.a.productId)).toBe(3);
  });
});
