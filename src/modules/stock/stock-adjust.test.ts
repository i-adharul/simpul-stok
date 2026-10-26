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
import * as adjustRoute from "../../app/api/stock/adjust/route";
import type { RequestContext } from "../platform/request-context";
import { createTenantClient } from "../platform/tenant-client";
import { adjustStock, planAdjustment } from "./stock-adjust-service";
import type { AdjustBody } from "./stock-schema";

// BL12, BL15, BL09, BL14.
let prisma: PrismaClient;
let pool: PrismaClient;
let t: TwoTenants;

beforeAll(() => {
  const url = assertTestDatabaseUrl(env.TEST_DATABASE_URL);
  prisma = createTestPrisma(url);
  pool = createTestPrisma(url, { max: 25 });
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

async function adjust(role: Role, body: unknown, key: string | null = randomUUID()) {
  return callRoute(adjustRoute.POST, {
    method: "POST",
    path: "/api/stock/adjust",
    cookie: await cookieFor(t.a.users[role]),
    headers: key ? { "Idempotency-Key": key } : undefined,
    body,
  });
}
const valid = (extra: Record<string, unknown> = {}) => ({
  warehouseId: t.a.warehouseId,
  productId: t.a.productId,
  mode: "SET",
  value: 10,
  reason: "STOCK_OPNAME",
  ...extra,
});
const seed = (quantity: number) =>
  prisma.stockLevel.create({
    data: {
      organizationId: t.a.organizationId,
      warehouseId: t.a.warehouseId,
      productId: t.a.productId,
      quantity,
    },
  });
const levelOf = async () =>
  (
    await prisma.stockLevel.findUnique({
      where: {
        warehouseId_productId: { warehouseId: t.a.warehouseId, productId: t.a.productId },
      },
    })
  )?.quantity ?? null;
const movements = () =>
  prisma.stockMovement.findMany({ where: { organizationId: t.a.organizationId } });

describe("planAdjustment", () => {
  const set = (value: number): AdjustBody =>
    ({ ...(valid() as object), mode: "SET", value }) as AdjustBody;
  const delta = (value: number): AdjustBody =>
    ({ ...(valid() as object), mode: "DELTA", value }) as AdjustBody;
  it("computes next and delta", () => {
    expect(planAdjustment(4, set(10))).toEqual({ next: 10, delta: 6 });
    expect(planAdjustment(4, delta(-4))).toEqual({ next: 0, delta: -4 });
  });
  it("rejects zero difference (400), below zero (409) and above the maximum (400)", () => {
    expect(() => planAdjustment(4, set(4))).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => planAdjustment(4, delta(-5))).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => planAdjustment(500_000, delta(600_000))).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    expect(() => planAdjustment(1_000_000, set(0))).not.toThrow();
  });
});

describe("POST /api/stock/adjust", () => {
  it("SET from a missing row: creates the level and an ADJUST movement with delta and reason", async () => {
    const res = await adjust("OWNER", valid({ note: " opname " }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toMatchObject({ quantity: 10, reason: "STOCK_OPNAME" });
    expect(await levelOf()).toBe(10);
    const [m] = await movements();
    expect(m).toMatchObject({
      type: "ADJUST",
      quantityDelta: 10,
      reason: "STOCK_OPNAME",
      note: "opname",
      createdById: t.a.users.OWNER,
    });
  });

  it("SET to a lower value stores a negative delta; DELTA adds to the current stock", async () => {
    await seed(10);
    expect((await adjust("OWNER", valid({ value: 4 }))).status).toBe(201);
    expect(await levelOf()).toBe(4);
    expect(
      (await adjust("OWNER", valid({ mode: "DELTA", value: 3, reason: "CORRECTION" }))).status,
    ).toBe(201);
    expect(await levelOf()).toBe(7);
    expect((await movements()).map((m) => m.quantityDelta).sort()).toEqual([-6, 3]);
  });

  it("gives 400 for a difference of 0 and writes nothing", async () => {
    await seed(10);
    expect((await adjust("OWNER", valid({ value: 10 }))).status).toBe(400);
    expect((await adjust("OWNER", valid({ mode: "DELTA", value: 0 }))).status).toBe(400);
    expect(await movements()).toHaveLength(0);
  });

  it("gives 409 in Indonesian when DELTA would go below zero, and keeps the stock", async () => {
    await seed(2);
    const res = await adjust("OWNER", valid({ mode: "DELTA", value: -3 }));
    expect(res.status).toBe(409);
    expect((await res.json()).message).toMatch(/kurang dari 0/);
    expect(await levelOf()).toBe(2);
    expect(await movements()).toHaveLength(0);
  });

  it("gives 400 above the maximum and for a missing or unknown reason", async () => {
    expect((await adjust("OWNER", valid({ value: 1_000_001 }))).status).toBe(400);
    await seed(900_000);
    expect((await adjust("OWNER", valid({ mode: "DELTA", value: 200_000 }))).status).toBe(400);
    expect((await adjust("OWNER", valid({ reason: undefined }))).status).toBe(400);
    expect((await adjust("OWNER", valid({ reason: "OTHER" }))).status).toBe(400);
    expect((await adjust("OWNER", valid({ value: -1 }))).status).toBe(400);
    expect(await levelOf()).toBe(900_000);
  });

  it("accepts SET 0 and the boundary 1,000,000", async () => {
    expect((await adjust("OWNER", valid({ value: 1_000_000 }))).status).toBe(201);
    expect((await adjust("OWNER", valid({ value: 0 }))).status).toBe(201);
    expect(await levelOf()).toBe(0);
  });

  it("allows an archived product (BL09) but not an archived warehouse", async () => {
    await seed(5);
    await prisma.product.update({ where: { id: t.a.productId }, data: { archivedAt: new Date() } });
    expect((await adjust("OWNER", valid({ value: 0 }))).status).toBe(201);
    await prisma.warehouse.update({
      where: { id: t.a.warehouseId },
      data: { archivedAt: new Date() },
    });
    expect((await adjust("OWNER", valid({ value: 3 }))).status).toBe(403);
  });

  it("rejects organizationId in the body, a Viewer (403) and a missing Idempotency-Key (400)", async () => {
    expect((await adjust("OWNER", valid({ organizationId: t.b.organizationId }))).status).toBe(400);
    expect((await adjust("VIEWER", valid())).status).toBe(403);
    expect((await adjust("OWNER", valid(), null)).status).toBe(400);
    expect(await movements()).toHaveLength(0);
  });

  it("lets a Warehouse Admin adjust an assigned warehouse", async () => {
    expect((await adjust("WAREHOUSE_ADMIN", valid())).status).toBe(201);
  });

  it("replays the same key: identical body, replay header, one movement", async () => {
    const key = randomUUID();
    const first = await adjust("OWNER", valid(), key);
    const second = await adjust("OWNER", valid(), key);
    expect(await second.text()).toBe(await first.text());
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await movements()).toHaveLength(1);
  });
});

describe("adjustStock (service)", () => {
  it("10 parallel DELTA -1 on stock 6: exactly 6 succeed, the rest 409, never negative", async () => {
    await seed(6);
    const ctx: RequestContext = {
      userId: t.a.users.OWNER,
      organizationId: t.a.organizationId,
      role: "OWNER",
      warehouseIds: [t.a.warehouseId],
    };
    const db = createTenantClient(pool, ctx);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        adjustStock(db, ctx, randomUUID(), {
          warehouseId: t.a.warehouseId,
          productId: t.a.productId,
          mode: "DELTA",
          value: -1,
          reason: "LOST",
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(6);
    expect(await levelOf()).toBe(0);
    expect(await movements()).toHaveLength(6);
  });
});
