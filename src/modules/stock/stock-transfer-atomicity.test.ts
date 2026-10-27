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
import { createTenantClient } from "../platform/tenant-client";
import { transferStock } from "./stock-transfer-service";

// E5-02 (BL13). A failure after the source was decremented must undo everything. No hook in production
// code: the failure is made by the data itself (the 32-bit column maximum, or a later item without stock).

const INT_MAX = 2_147_483_647;

let prisma: PrismaClient;
let pool: PrismaClient;
let t: TwoTenants;

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
});

const orgWhere = () => ({ organizationId: t.a.organizationId });
async function expectNothingWritten() {
  expect(await prisma.stockTransfer.count({ where: orgWhere() })).toBe(0);
  expect(await prisma.stockMovement.count({ where: orgWhere() })).toBe(0);
  expect(await prisma.idempotencyKey.count({ where: orgWhere() })).toBe(0);
}

describe("transfer atomicity (E5-02)", () => {
  it("rolls back the source decrement when the destination overflows, and a retry works after the fix", async () => {
    const source = t.a.warehouseId;
    const destination = await secondWarehouseId(prisma, t);
    await seedLevel(prisma, t, source, t.a.productId, 5);
    await seedLevel(prisma, t, destination, t.a.productId, INT_MAX);
    const ctx = await ownerContextOf(prisma, t);
    const db = createTenantClient(pool, ctx);
    const key = randomUUID();
    const body = {
      fromWarehouseId: source,
      toWarehouseId: destination,
      items: [{ productId: t.a.productId, quantity: 3 }],
    };

    await expect(transferStock(db, ctx, key, body)).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
    });
    expect(await quantityOf(prisma, source, t.a.productId)).toBe(5);
    expect(await quantityOf(prisma, destination, t.a.productId)).toBe(INT_MAX);
    await expectNothingWritten();

    await seedLevel(prisma, t, destination, t.a.productId, 0);
    const retry = await transferStock(db, ctx, key, body);
    expect(retry.replayed).toBe(false);
    expect(retry.result.code).toBe("MT-0001");
    expect(await quantityOf(prisma, source, t.a.productId)).toBe(2);
    expect(await quantityOf(prisma, destination, t.a.productId)).toBe(3);
  });

  it("changes nothing for earlier items when the LAST item has insufficient stock", async () => {
    const source = t.a.warehouseId;
    const destination = await secondWarehouseId(prisma, t);
    const extra = [await addProduct(prisma, t, "SKU-2"), await addProduct(prisma, t, "SKU-3")];
    // The service works in productId order, so the product with the largest id is processed last.
    const [first, second, last] = [t.a.productId, ...extra].sort();
    for (const [productId, quantity] of [
      [first, 10],
      [second, 10],
      [last, 1],
    ] as const) {
      await seedLevel(prisma, t, source, productId!, quantity);
    }
    const ctx = await ownerContextOf(prisma, t);
    const db = createTenantClient(pool, ctx);

    await expect(
      transferStock(db, ctx, randomUUID(), {
        fromWarehouseId: source,
        toWarehouseId: destination,
        items: [last!, first!, second!].map((productId) => ({ productId, quantity: 5 })),
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "INSUFFICIENT_STOCK",
      details: { productId: last },
    });

    expect(await quantityOf(prisma, source, first!)).toBe(10);
    expect(await quantityOf(prisma, source, second!)).toBe(10);
    expect(await quantityOf(prisma, source, last!)).toBe(1);
    expect(await prisma.stockLevel.count({ where: { warehouseId: destination } })).toBe(0);
    await expectNothingWritten();
  });
});
