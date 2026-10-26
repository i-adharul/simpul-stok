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
import * as adjustRoute from "../../app/api/stock/adjust/route";
import type { RequestContext } from "../platform/request-context";
import { createTenantClient } from "../platform/tenant-client";
import { receiveStock } from "./stock-service";
import { adjustStock } from "./stock-adjust-service";

// E4-10: the gaps that stock-receive.test.ts, stock-adjust.test.ts and the idempotency tests leave for
// BL11, BL12, BL14 and BL15, proven through the real endpoints. Every test builds its own two tenants.
// Cross-tenant 404 and role 403 for every stock endpoint come from the registry harness
// (src/test/tenant-isolation/registry.ts); only the unassigned-warehouse 403 of adjust is added here.

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

async function post(
  route: typeof receiveRoute.POST | typeof adjustRoute.POST,
  path: string,
  role: Role,
  body: unknown,
  key: string = randomUUID(),
) {
  return callRoute(route, {
    method: "POST",
    path,
    cookie: await cookieFor(t.a.users[role]),
    headers: { "Idempotency-Key": key },
    body,
  });
}
const receive = (body: unknown, key?: string, role: Role = "OWNER") =>
  post(receiveRoute.POST, "/api/stock/receive", role, body, key);
const adjust = (body: unknown, key?: string, role: Role = "OWNER") =>
  post(adjustRoute.POST, "/api/stock/adjust", role, body, key);

const pair = { warehouseId: () => t.a.warehouseId, productId: () => t.a.productId };
const recvBody = (quantity: unknown) => ({
  warehouseId: pair.warehouseId(),
  productId: pair.productId(),
  quantity,
});
const adjBody = (mode: "SET" | "DELTA", value: unknown) => ({
  warehouseId: pair.warehouseId(),
  productId: pair.productId(),
  mode,
  value,
  reason: "CORRECTION",
});

const where = () => ({
  warehouseId_productId: { warehouseId: t.a.warehouseId, productId: t.a.productId },
});
const levelOf = async () =>
  (await prisma.stockLevel.findUnique({ where: where() }))?.quantity ?? null;
const movements = () =>
  prisma.stockMovement.findMany({ where: { organizationId: t.a.organizationId } });
const seed = (quantity: number) =>
  prisma.stockLevel.create({
    data: {
      organizationId: t.a.organizationId,
      warehouseId: t.a.warehouseId,
      productId: t.a.productId,
      quantity,
    },
  });

describe("BL11 receive quantity boundaries", () => {
  it("accepts 1 and 1,000,000 and stores the quantity as the movement delta", async () => {
    expect((await receive(recvBody(1))).status).toBe(201);
    expect((await receive(recvBody(1_000_000))).status).toBe(201);
    expect(await levelOf()).toBe(1_000_001);
    expect((await movements()).map((m) => m.quantityDelta).sort((a, b) => a - b)).toEqual([
      1, 1_000_000,
    ]);
  });

  it.each([0, -1, 1_000_001, 1.5, "5", null, Number.MAX_SAFE_INTEGER])(
    "rejects quantity %j with 400 and writes nothing",
    async (quantity) => {
      const res = await receive(recvBody(quantity));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("VALIDATION_ERROR");
      expect(await levelOf()).toBeNull();
      expect(await movements()).toHaveLength(0);
    },
  );
});

describe("BL12 adjust boundaries and results", () => {
  it("accepts DELTA +1 and -1, and DELTA -1,000,000 that lands exactly on 0", async () => {
    await seed(1_000_000);
    expect((await adjust(adjBody("DELTA", -1_000_000))).status).toBe(201);
    expect(await levelOf()).toBe(0);
    expect((await adjust(adjBody("DELTA", 1))).status).toBe(201);
    expect((await adjust(adjBody("DELTA", -1))).status).toBe(201);
    expect(await levelOf()).toBe(0);
    expect((await movements()).map((m) => m.quantityDelta).sort((a, b) => a - b)).toEqual([
      -1_000_000, -1, 1,
    ]);
  });

  it("accepts DELTA +1,000,000 from 0 and rejects the result above 1,000,000 with 400", async () => {
    expect((await adjust(adjBody("DELTA", 1_000_000))).status).toBe(201);
    expect(await levelOf()).toBe(1_000_000);
    expect((await adjust(adjBody("DELTA", 1))).status).toBe(400);
    expect(await levelOf()).toBe(1_000_000);
  });

  it.each([
    ["DELTA", 1_000_001],
    ["DELTA", -1_000_001],
    ["DELTA", 1.5],
    ["DELTA", "3"],
    ["SET", -1],
    ["SET", 1_000_001],
    ["SET", 0.5],
  ] as const)("rejects %s %j with 400 and writes nothing", async (mode, value) => {
    expect((await adjust(adjBody(mode, value))).status).toBe(400);
    expect(await levelOf()).toBeNull();
    expect(await movements()).toHaveLength(0);
  });

  it("gives 409 for a negative result from a missing row and from exactly one below 0", async () => {
    expect((await adjust(adjBody("DELTA", -1))).status).toBe(409);
    expect(await levelOf()).toBeNull();
    await seed(5);
    expect((await adjust(adjBody("DELTA", -6))).status).toBe(409);
    expect((await adjust(adjBody("DELTA", -5))).status).toBe(201);
    expect(await levelOf()).toBe(0);
    expect(await movements()).toHaveLength(1);
  });

  it("gives a Warehouse Admin 403 for an unassigned warehouse and writes nothing", async () => {
    const other = await prisma.warehouse.create({
      data: { organizationId: t.a.organizationId, code: "W9", name: "unassigned" },
    });
    const res = await adjust(
      { ...adjBody("SET", 5), warehouseId: other.id },
      undefined,
      "WAREHOUSE_ADMIN",
    );
    expect(res.status).toBe(403);
    expect(await movements()).toHaveLength(0);
  });
});

describe("BL14 same key on the real endpoints", () => {
  it("five concurrent receipts with one key add the stock once", async () => {
    const key = randomUUID();
    const replies = await Promise.all(Array.from({ length: 5 }, () => receive(recvBody(7), key)));
    const texts = await Promise.all(replies.map((r) => r.text()));
    expect(replies.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(texts).size).toBe(1);
    expect(replies.filter((r) => r.headers.get("Idempotency-Replayed") === "true")).toHaveLength(4);
    expect(await levelOf()).toBe(7);
    expect(await movements()).toHaveLength(1);
  });

  it("five concurrent adjustments with one key apply the difference once", async () => {
    await seed(10);
    const key = randomUUID();
    const replies = await Promise.all(
      Array.from({ length: 5 }, () => adjust(adjBody("DELTA", -4), key)),
    );
    expect(new Set(replies.map((r) => r.status))).toEqual(new Set([201]));
    expect(await levelOf()).toBe(6);
    expect(await movements()).toHaveLength(1);
  });

  it("replays after repeated sends and does not compare the body", async () => {
    const key = randomUUID();
    const first = await receive(recvBody(3), key);
    for (const q of [3, 9, 3]) {
      const again = await receive(recvBody(q), key);
      expect(again.status).toBe(201);
      expect(await again.text()).toBe(await first.clone().text());
    }
    expect(await levelOf()).toBe(3);
  });

  it("a replayed adjustment that failed with 409 leaves no key, so the retry runs again", async () => {
    const key = randomUUID();
    expect((await adjust(adjBody("DELTA", -2), key)).status).toBe(409);
    await seed(2);
    expect((await adjust(adjBody("DELTA", -2), key)).status).toBe(201);
    expect(await levelOf()).toBe(0);
  });

  it("the same key on receive and on adjust are independent endpoints", async () => {
    const key = randomUUID();
    expect((await receive(recvBody(4), key)).status).toBe(201);
    const res = await adjust(adjBody("DELTA", 2), key);
    expect(res.status).toBe(201);
    expect(res.headers.get("Idempotency-Replayed")).toBeNull();
    expect(await levelOf()).toBe(6);
  });
});

describe("BL15 non-negative stock under concurrency", () => {
  const ctx = (): RequestContext => ({
    userId: t.a.users.OWNER,
    organizationId: t.a.organizationId,
    role: "OWNER",
    warehouseIds: [t.a.warehouseId],
  });

  it("mixed receipts and decrements keep stock >= 0 and equal to the sum of the movements", async () => {
    await seed(5);
    const db = createTenantClient(pool, ctx());
    const jobs = Array.from({ length: 24 }, (_, i) =>
      i % 3 === 0
        ? receiveStock(db, ctx(), randomUUID(), {
            warehouseId: t.a.warehouseId,
            productId: t.a.productId,
            quantity: 2,
          })
        : adjustStock(db, ctx(), randomUUID(), {
            warehouseId: t.a.warehouseId,
            productId: t.a.productId,
            mode: "DELTA",
            value: -1,
            reason: "LOST",
          }),
    );
    const results = await Promise.allSettled(jobs);
    for (const r of results) {
      if (r.status === "rejected") expect((r.reason as { status?: number }).status).toBe(409);
    }
    const level = await levelOf();
    const sum = (await movements()).reduce((s, m) => s + m.quantityDelta, 0);
    expect(level).toBeGreaterThanOrEqual(0);
    expect(level).toBe(5 + sum);
  });

  it("the database CHECK refuses a negative quantity even when the guard is bypassed", async () => {
    await seed(1);
    await expect(
      prisma.stockLevel.update({ where: where(), data: { quantity: { decrement: 2 } } }),
    ).rejects.toThrow(/stock_levels_quantity_check|check constraint/i);
    expect(await levelOf()).toBe(1);
  });
});
