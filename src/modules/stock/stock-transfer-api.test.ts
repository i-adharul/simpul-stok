import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import { env } from "../../lib/env";
import * as destinationsRoute from "../../app/api/stock/transfers/destinations/route";
import * as transfersRoute from "../../app/api/stock/transfers/route";
import { addProduct, quantityOf, seedLevel } from "../../test/stock-fixtures";
import { assertTestDatabaseUrl, createTestPrisma } from "../../test/test-database";
import {
  callRoute,
  cookieFor,
  createTwoTenants,
  type TwoTenants,
} from "../../test/tenant-isolation/fixtures";

// E5-04 (BL13, BL14): the endpoint itself. The service rules are in stock-transfer.test.ts; here the
// answers a client sees: 400 from the schema, 403 by role, replay, and the code-retry exhaustion (409).

let prisma: PrismaClient;
let t: TwoTenants;
let productId: string;

beforeAll(() => {
  prisma = createTestPrisma(assertTestDatabaseUrl(env.TEST_DATABASE_URL));
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  t = await createTwoTenants(prisma);
  await prisma.stockTransfer.delete({ where: { id: t.a.transferId } });
  productId = t.a.productId;
  await seedLevel(prisma, t, t.a.warehouseId, productId, 10);
});

type Role = "OWNER" | "WAREHOUSE_ADMIN" | "VIEWER";

const valid = (extra: Record<string, unknown> = {}) => ({
  fromWarehouseId: t.a.warehouseId,
  toWarehouseId: t.a.secondWarehouseId,
  items: [{ productId, quantity: 4 }],
  ...extra,
});

async function post(body: unknown, options: { role?: Role; key?: string } = {}) {
  return callRoute(transfersRoute.POST, {
    method: "POST",
    path: "/api/stock/transfers",
    cookie: await cookieFor(t.a.users[options.role ?? "OWNER"]),
    headers: { "Idempotency-Key": options.key ?? randomUUID() },
    body,
  });
}

const expectValidation = async (response: Response) => {
  expect(response.status).toBe(400);
  expect(((await response.json()) as { code: string }).code).toBe("VALIDATION_ERROR");
};
const counts = async () => ({
  transfers: await prisma.stockTransfer.count({ where: { organizationId: t.a.organizationId } }),
  movements: await prisma.stockMovement.count({ where: { organizationId: t.a.organizationId } }),
  keys: await prisma.idempotencyKey.count({ where: { organizationId: t.a.organizationId } }),
});

describe("POST /api/stock/transfers", () => {
  it("answers 201 with the immutable transfer, never stock balances", async () => {
    const response = await post(valid({ note: "  pindah  " }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: expect.any(String),
      code: "MT-0001",
      fromWarehouseId: t.a.warehouseId,
      toWarehouseId: t.a.secondWarehouseId,
      items: [{ productId, quantity: 4 }],
      note: "pindah",
      createdAt: expect.any(String),
    });
    expect(await quantityOf(prisma, t.a.warehouseId, productId)).toBe(6);
    expect(await quantityOf(prisma, t.a.secondWarehouseId, productId)).toBe(4);
  });

  it("rejects bad input with a real 400 and writes nothing", async () => {
    const many = Array.from({ length: 51 }, () => ({ productId: randomUUID(), quantity: 1 }));
    const cases: unknown[] = [
      valid({ items: many }),
      valid({ items: [] }),
      valid({
        items: [
          { productId, quantity: 1 },
          { productId, quantity: 2 },
        ],
      }),
      valid({ items: [{ productId, quantity: 0 }] }),
      valid({ items: [{ productId, quantity: 1_000_001 }] }),
      valid({ toWarehouseId: t.a.warehouseId }),
      valid({ organizationId: t.b.organizationId }),
    ];
    for (const body of cases) await expectValidation(await post(body));
    expect(await counts()).toEqual({ transfers: 0, movements: 0, keys: 0 });
  });

  it("answers 403 to a Viewer, and to a Warehouse Admin without rights on the source", async () => {
    expect((await post(valid(), { role: "VIEWER" })).status).toBe(403);
    // W2 is not assigned to the Warehouse Admin, so it cannot be a source.
    const fromUnassigned = valid({
      fromWarehouseId: t.a.secondWarehouseId,
      toWarehouseId: t.a.warehouseId,
    });
    expect((await post(fromUnassigned, { role: "WAREHOUSE_ADMIN" })).status).toBe(403);
    expect(await counts()).toEqual({ transfers: 0, movements: 0, keys: 0 });
  });

  it("lets a Warehouse Admin move stock to a warehouse it is not assigned to", async () => {
    expect((await post(valid(), { role: "WAREHOUSE_ADMIN" })).status).toBe(201);
  });

  it("answers a replay identically, with the replay header, and moves stock once", async () => {
    const key = randomUUID();
    const first = await post(valid(), { key });
    const second = await post(valid(), { key });
    expect(second.status).toBe(first.status);
    expect(await second.text()).toBe(await first.text());
    expect(first.headers.get("Idempotency-Replayed")).toBeNull();
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await quantityOf(prisma, t.a.warehouseId, productId)).toBe(6);
    expect((await counts()).transfers).toBe(1);
  });

  it("answers 409 INSUFFICIENT_STOCK with the failing product", async () => {
    const other = await addProduct(prisma, t, "SKU-LOW");
    await seedLevel(prisma, t, t.a.warehouseId, other, 1);
    const response = await post(
      valid({
        items: [
          { productId, quantity: 1 },
          { productId: other, quantity: 2 },
        ],
      }),
    );
    expect(response.status).toBe(409);
    const json = (await response.json()) as { code: string; details: unknown };
    expect(json.code).toBe("INSUFFICIENT_STOCK");
    expect(json.details).toEqual({ productId: other });
    expect(await quantityOf(prisma, t.a.warehouseId, productId)).toBe(10);
  });

  // No hook: one transfer coded MT-0002 exists, so the count is 1 and the next code is MT-0002 on every
  // attempt. The retries run out and the whole call is rolled back.
  it("answers 409 when the code collides on every retry, and writes nothing", async () => {
    await prisma.stockTransfer.create({
      data: {
        organizationId: t.a.organizationId,
        code: "MT-0002",
        fromWarehouseId: t.a.warehouseId,
        toWarehouseId: t.a.secondWarehouseId,
        createdById: t.a.users.OWNER,
      },
    });
    const response = await post(valid());
    expect(response.status).toBe(409);
    expect(((await response.json()) as { message: string }).message).toBe(
      "Terlalu banyak mutasi bersamaan, coba lagi.",
    );
    expect(await quantityOf(prisma, t.a.warehouseId, productId)).toBe(10);
    expect(await quantityOf(prisma, t.a.secondWarehouseId, productId)).toBeNull();
    expect(await counts()).toEqual({ transfers: 1, movements: 0, keys: 0 });
  });
});

describe("GET /api/stock/transfers/destinations", () => {
  const get = async (role: Role) =>
    callRoute(destinationsRoute.GET, {
      method: "GET",
      path: "/api/stock/transfers/destinations",
      cookie: await cookieFor(t.a.users[role]),
    });

  it("gives a Warehouse Admin every active warehouse, assigned or not, and no archived one", async () => {
    const archived = await prisma.warehouse.create({
      data: {
        organizationId: t.a.organizationId,
        code: "OLD",
        name: "Old",
        archivedAt: new Date(),
      },
    });
    const response = await get("WAREHOUSE_ADMIN");
    expect(response.status).toBe(200);
    const { items } = (await response.json()) as {
      items: { id: string; code: string; name: string }[];
    };
    expect(items.map((w) => w.code)).toEqual(["W1", "W2"]);
    expect(items.map((w) => w.id)).not.toContain(archived.id);
    expect(Object.keys(items[0]).sort()).toEqual(["code", "id", "name"]);
  });

  it("answers 403 to a Viewer", async () => {
    expect((await get("VIEWER")).status).toBe(403);
  });
});
