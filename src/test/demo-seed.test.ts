import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { demoKey, seedDemo } from "../../prisma/demo-seed";
import {
  DEMO_ADJUSTMENTS,
  DEMO_PRODUCTS,
  DEMO_RECEIPTS,
  DEMO_TRANSFERS,
  DEMO_WAREHOUSES,
} from "../../prisma/demo-data";
import { env } from "../lib/env";
import type { PrismaClient } from "../generated/prisma/client";
import { stockStatusOf } from "../modules/stock/stock-status";
import { assertTestDatabaseUrl, createTestPrisma } from "./test-database";
import { resetTenantTables } from "./tenant-isolation/fixtures";

let prisma: PrismaClient;

beforeAll(() => {
  prisma = createTestPrisma(assertTestDatabaseUrl(env.TEST_DATABASE_URL));
});
beforeEach(async () => {
  await resetTenantTables(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

const counts = async () => ({
  warehouses: await prisma.warehouse.count(),
  products: await prisma.product.count(),
  levels: await prisma.stockLevel.count(),
  movements: await prisma.stockMovement.count(),
  transfers: await prisma.stockTransfer.count(),
  keys: await prisma.idempotencyKey.count(),
  assignments: await prisma.userWarehouse.count(),
});

describe("demoKey", () => {
  it("is a valid UUID and stable for a name", () => {
    expect(demoKey("a")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(demoKey("a")).toBe(demoKey("a"));
    expect(demoKey("a")).not.toBe(demoKey("b"));
  });

  it("gives every operation of the demo data its own key", () => {
    const names = [...DEMO_RECEIPTS, ...DEMO_ADJUSTMENTS, ...DEMO_TRANSFERS].map((o) => o.name);
    expect(new Set(names.map(demoKey)).size).toBe(names.length);
  });
});

describe("seedDemo", () => {
  it("creates the documented amount of data", async () => {
    await seedDemo(prisma);
    const c = await counts();
    expect(c.warehouses).toBe(DEMO_WAREHOUSES.length);
    expect(c.products).toBe(DEMO_PRODUCTS.length);
    expect(c.transfers).toBe(DEMO_TRANSFERS.length);
    expect(c.movements).toBeGreaterThanOrEqual(28);
    expect(c.movements).toBeLessThanOrEqual(36);
    expect(c.assignments).toBe(3); // admin: 1 warehouse, viewer: 2
  });

  it("running twice creates nothing twice", async () => {
    await seedDemo(prisma);
    const first = await counts();
    await seedDemo(prisma);
    expect(await counts()).toEqual(first);
  });

  it("keeps the movement ledger equal to the stock levels", async () => {
    await seedDemo(prisma);
    const levels = await prisma.stockLevel.findMany();
    for (const level of levels) {
      const sum = await prisma.stockMovement.aggregate({
        where: { warehouseId: level.warehouseId, productId: level.productId },
        _sum: { quantityDelta: true },
      });
      expect(sum._sum.quantityDelta).toBe(level.quantity);
    }
  });

  it("leaves some LOW and some OUT pairs for the dashboard, and none negative", async () => {
    await seedDemo(prisma);
    const levels = await prisma.stockLevel.findMany({ include: { product: true } });
    const statuses = levels.map((l) => stockStatusOf(l.quantity, l.product.minStock));
    // The e2e login scenario asserts these two numbers (e2e/login.spec.ts).
    expect(statuses.filter((status) => status === "LOW")).toHaveLength(8);
    expect(statuses.filter((status) => status === "OUT")).toHaveLength(2);
    expect(statuses).toContain("OK");
    expect(levels.every((l) => l.quantity >= 0)).toBe(true);
  });

  it("uses the committed local passwords by default and keeps the platform admin", async () => {
    await seedDemo(prisma);
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: "owner@demotoko.test" } });
    expect(await bcrypt.compare("owner-demo-2026", owner.passwordHash)).toBe(true);
    expect(await prisma.user.count({ where: { role: "PLATFORM_ADMIN" } })).toBe(1);
  });

  it("with a password override: every account uses it and there is no platform admin", async () => {
    await seedDemo(prisma, { password: "remote-demo-pass-7" });
    const users = await prisma.user.findMany();
    expect(users.map((u) => u.role).sort()).toEqual(["OWNER", "VIEWER", "WAREHOUSE_ADMIN"]);
    for (const user of users) {
      expect(await bcrypt.compare("remote-demo-pass-7", user.passwordHash)).toBe(true);
    }
  });
});
