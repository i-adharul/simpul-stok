import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import { env } from "../../lib/env";
import * as detailRoute from "../../app/api/stock/transfers/[id]/route";
import * as transfersRoute from "../../app/api/stock/transfers/route";
import { addWarehouse, seedLevel } from "../../test/stock-fixtures";
import { assertTestDatabaseUrl, createTestPrisma } from "../../test/test-database";
import {
  callRoute,
  cookieFor,
  createTwoTenants,
  type TwoTenants,
} from "../../test/tenant-isolation/fixtures";

// E5-05 (BL16): GET /api/stock/transfers/:id. Visible to anyone allowed to see the source or the
// destination warehouse; everything else is the same 404 as a missing id (rule 2).

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
  productId = t.a.productId;
  await seedLevel(prisma, t, t.a.warehouseId, productId, 10);
  await seedLevel(prisma, t, t.a.secondWarehouseId, productId, 10);
});

type Role = "OWNER" | "WAREHOUSE_ADMIN" | "VIEWER";

// The Warehouse Admin and the Viewer are assigned to W1 (warehouseId) only; W2 is unassigned.
async function makeTransfer(from: string, to: string): Promise<string> {
  const response = await callRoute(transfersRoute.POST, {
    method: "POST",
    path: "/api/stock/transfers",
    cookie: await cookieFor(t.a.users.OWNER),
    headers: { "Idempotency-Key": randomUUID() },
    body: {
      fromWarehouseId: from,
      toWarehouseId: to,
      items: [{ productId, quantity: 3 }],
      note: "x",
    },
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function get(id: string, role: Role = "OWNER", org: "a" | "b" = "a") {
  return callRoute(detailRoute.GET, {
    method: "GET",
    path: `/api/stock/transfers/${id}`,
    cookie: await cookieFor(t[org].users[role]),
    params: { id },
  });
}

describe("GET /api/stock/transfers/:id", () => {
  it("returns the header, both warehouses and the items with their movement ids", async () => {
    const id = await makeTransfer(t.a.warehouseId, t.a.secondWarehouseId);
    const response = await get(id);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      id,
      code: "MT-0002",
      note: "x",
      createdBy: { id: t.a.users.OWNER, role: "OWNER" },
      fromWarehouse: { id: t.a.warehouseId },
      toWarehouse: { id: t.a.secondWarehouseId },
    });
    expect(body.createdBy).not.toHaveProperty("email");
    expect(body.items).toEqual([
      {
        productId,
        sku: "SKU-1",
        name: expect.any(String),
        unit: "pcs",
        quantity: 3,
        outMovementId: expect.any(String),
        inMovementId: expect.any(String),
      },
    ]);
  });

  it("is visible to a user assigned to the source only, without the other side's movement", async () => {
    const id = await makeTransfer(t.a.warehouseId, t.a.secondWarehouseId);
    for (const role of ["WAREHOUSE_ADMIN", "VIEWER"] as const) {
      const response = await get(id, role);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { items: Record<string, unknown>[] };
      expect(body.items[0].outMovementId).toEqual(expect.any(String));
      expect(body.items[0].inMovementId).toBeNull();
    }
  });

  it("is visible to a user assigned to the destination only", async () => {
    const id = await makeTransfer(t.a.secondWarehouseId, t.a.warehouseId);
    const response = await get(id, "WAREHOUSE_ADMIN");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Record<string, unknown>[] };
    expect(body.items[0].outMovementId).toBeNull();
    expect(body.items[0].inMovementId).toEqual(expect.any(String));
  });

  it("answers 404 when the user has neither warehouse, the same as a missing id", async () => {
    const third = await addWarehouse(prisma, t, "W3");
    const id = await makeTransfer(t.a.secondWarehouseId, third);
    const hidden = await get(id, "VIEWER");
    const missing = await get(randomUUID(), "VIEWER");
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual(await missing.json());
    expect((await get(id, "OWNER")).status).toBe(200);
  });

  it("answers 404 for another organization's transfer and for a malformed id", async () => {
    expect((await get(t.b.transferId, "OWNER")).status).toBe(404);
    expect((await get("not-a-uuid")).status).toBe(404);
  });
});
