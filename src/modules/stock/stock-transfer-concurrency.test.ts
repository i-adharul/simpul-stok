import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import { env } from "../../lib/env";
import {
  addWarehouse,
  ownerContextOf,
  quantityOf,
  secondWarehouseId,
  seedLevel,
} from "../../test/stock-fixtures";
import { assertTestDatabaseUrl, createTestPrisma } from "../../test/test-database";
import { createTwoTenants, type TwoTenants } from "../../test/tenant-isolation/fixtures";
import { createTenantClient } from "../platform/tenant-client";
import { transferStock } from "./stock-transfer-service";

// E5-01 (BL13, BL15). Written before the service: it fails first (the stub throws), then the service of
// E5-03 makes it pass. A pool of 50 holds the 40 transactions of the deadlock test at once, so a waiting
// transaction never starves the pool and fails on maxWait instead of on the rule under test.

let prisma: PrismaClient;
let pool: PrismaClient;
let t: TwoTenants;

beforeAll(() => {
  const url = assertTestDatabaseUrl(env.TEST_DATABASE_URL);
  prisma = createTestPrisma(url);
  pool = createTestPrisma(url, { max: 50 });
});
afterAll(async () => {
  await prisma.$disconnect();
  await pool.$disconnect();
});
beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  t = await createTwoTenants(prisma);
  // The tenant fixture inserts a transfer coded MT-1; codes must start at MT-0001 here.
  await prisma.stockTransfer.delete({ where: { id: t.a.transferId } });
});

const orgWhere = () => ({ organizationId: t.a.organizationId });
const one = (fromWarehouseId: string, toWarehouseId: string) => ({
  fromWarehouseId,
  toWarehouseId,
  items: [{ productId: t.a.productId, quantity: 1 }],
});
const codes = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => `MT-${String(from + i).padStart(4, "0")}`);

describe("transfer concurrency (E5-01)", () => {
  it("20 parallel transfers of 1 unit against a stock of 10: exactly 10 succeed", async () => {
    const source = t.a.warehouseId;
    const destination = await secondWarehouseId(prisma, t);
    await seedLevel(prisma, t, source, t.a.productId, 10);
    const ctx = await ownerContextOf(prisma, t);
    const db = createTenantClient(pool, ctx);

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        transferStock(db, ctx, randomUUID(), one(source, destination)),
      ),
    );

    const failed = results.filter((r) => r.status === "rejected");
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    expect(failed).toHaveLength(10);
    for (const r of failed) {
      expect(r.reason).toMatchObject({ status: 409, code: "INSUFFICIENT_STOCK" });
    }
    expect(await quantityOf(prisma, source, t.a.productId)).toBe(0);
    expect(await quantityOf(prisma, destination, t.a.productId)).toBe(10);

    const transfers = await prisma.stockTransfer.findMany({ where: orgWhere() });
    expect(transfers.map((x) => x.code).sort()).toEqual(codes(10));
    const movements = await prisma.stockMovement.findMany({ where: orgWhere() });
    expect(movements).toHaveLength(20);
    expect(movements.filter((m) => m.type === "TRANSFER_OUT")).toHaveLength(10);
    expect(movements.filter((m) => m.type === "TRANSFER_IN")).toHaveLength(10);
    const levels = await prisma.stockLevel.findMany({ where: orgWhere() });
    expect(levels.every((l) => l.quantity >= 0)).toBe(true);
  });

  it("opposite transfers A to B and B to A, 20 each in parallel: no deadlock, totals preserved", async () => {
    const a = t.a.warehouseId;
    const b = await secondWarehouseId(prisma, t);
    await seedLevel(prisma, t, a, t.a.productId, 100);
    await seedLevel(prisma, t, b, t.a.productId, 100);
    const ctx = await ownerContextOf(prisma, t);
    const db = createTenantClient(pool, ctx);

    const results = await Promise.allSettled(
      Array.from({ length: 40 }, (_, i) =>
        i % 2 === 0
          ? transferStock(db, ctx, randomUUID(), one(a, b))
          : transferStock(db, ctx, randomUUID(), one(b, a)),
      ),
    );

    expect(results.filter((r) => r.status === "rejected").map((r) => String(r.reason))).toEqual([]);
    const [qa, qb] = await Promise.all([
      quantityOf(prisma, a, t.a.productId),
      quantityOf(prisma, b, t.a.productId),
    ]);
    expect((qa ?? 0) + (qb ?? 0)).toBe(200);
    expect([qa, qb]).toEqual([100, 100]); // 20 units moved each way
    expect(await prisma.stockTransfer.count({ where: orgWhere() })).toBe(40);
    expect(await prisma.stockMovement.count({ where: orgWhere() })).toBe(80);
  });

  it("transfers on three different warehouse pairs in parallel: unique, gap-free codes, no 500", async () => {
    const lanes: [string, string][] = [];
    for (const n of [1, 2, 3]) {
      const from = await addWarehouse(prisma, t, `S${n}`);
      const to = await addWarehouse(prisma, t, `D${n}`);
      await seedLevel(prisma, t, from, t.a.productId, 100);
      lanes.push([from, to]);
    }
    const ctx = await ownerContextOf(prisma, t);
    const db = createTenantClient(pool, ctx);

    const results = await Promise.allSettled(
      lanes.flatMap(([from, to]) =>
        Array.from({ length: 5 }, () => transferStock(db, ctx, randomUUID(), one(from, to))),
      ),
    );

    // Only a success or the 409 of "too many concurrent mutations" is acceptable; never a 500.
    for (const r of results) {
      if (r.status === "rejected") {
        expect(r.reason).toMatchObject({ status: 409, code: "CONFLICT" });
      }
    }
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    expect(succeeded).toBeGreaterThan(0);
    const transfers = await prisma.stockTransfer.findMany({ where: orgWhere() });
    expect(transfers.map((x) => x.code).sort()).toEqual(codes(succeeded));
  });
});
