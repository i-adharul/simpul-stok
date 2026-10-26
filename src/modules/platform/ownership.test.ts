import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api-error";
import { env } from "../../lib/env";
import type { PrismaClient } from "../../generated/prisma/client";
import { assertTestDatabaseUrl, createTestPrisma } from "../../test/test-database";
import { assertOwnedIds, findOwnedOrThrow } from "./ownership";
import { createTenantClient, type TenantClient } from "./tenant-client";

let prisma: PrismaClient;
let tenant: TenantClient;
let aWarehouse: string;
let aArchivedWarehouse: string;
let aProduct: string;
let bWarehouse: string;
let bProduct: string;
let bTransfer: string;
let aTransfer: string;

async function seedOrg(slug: string) {
  const org = await prisma.organization.create({ data: { name: slug, slug } });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: `o@${slug}.test`,
      name: "O",
      passwordHash: "h",
      role: "OWNER",
    },
  });
  const w1 = await prisma.warehouse.create({
    data: { organizationId: org.id, code: "W1", name: "W1" },
  });
  const w2 = await prisma.warehouse.create({
    data: { organizationId: org.id, code: "W2", name: "W2" },
  });
  const archived = await prisma.warehouse.create({
    data: { organizationId: org.id, code: "W3", name: "W3", archivedAt: new Date() },
  });
  const product = await prisma.product.create({
    data: { organizationId: org.id, sku: "S1", name: "P1", unit: "pcs" },
  });
  const transfer = await prisma.stockTransfer.create({
    data: {
      organizationId: org.id,
      code: "MT-1",
      fromWarehouseId: w1.id,
      toWarehouseId: w2.id,
      createdById: user.id,
    },
  });
  return { org, user, w1, archived, product, transfer };
}

beforeAll(() => {
  prisma = createTestPrisma(assertTestDatabaseUrl(env.TEST_DATABASE_URL));
});

beforeEach(async () => {
  assertTestDatabaseUrl(env.TEST_DATABASE_URL);
  await prisma.$executeRaw`TRUNCATE TABLE webhook_events, notifications, audit_logs, invoices,
    import_jobs, invitations, idempotency_keys, stock_movements, stock_transfers, stock_levels,
    user_warehouses, products, warehouses, subscriptions, users, plans, organizations
    RESTART IDENTITY CASCADE`;
  const a = await seedOrg("orga");
  const b = await seedOrg("orgb");
  aWarehouse = a.w1.id;
  aArchivedWarehouse = a.archived.id;
  aProduct = a.product.id;
  aTransfer = a.transfer.id;
  bWarehouse = b.w1.id;
  bProduct = b.product.id;
  bTransfer = b.transfer.id;
  tenant = createTenantClient(prisma, {
    userId: a.user.id,
    organizationId: a.org.id,
    role: "OWNER",
    warehouseIds: [],
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => {
      throw new Error("expected rejection");
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

const bodyOf = (error: ApiError) => error.toResponse().text();

describe("findOwnedOrThrow", () => {
  it("returns a row of the own organization", async () => {
    expect((await findOwnedOrThrow(tenant, "warehouse", aWarehouse)).id).toBe(aWarehouse);
    expect((await findOwnedOrThrow(tenant, "product", aProduct)).id).toBe(aProduct);
    expect((await findOwnedOrThrow(tenant, "stockTransfer", aTransfer)).id).toBe(aTransfer);
  });

  it("throws 404 NOT_FOUND for another organization's row", async () => {
    for (const [model, id] of [
      ["warehouse", bWarehouse],
      ["product", bProduct],
      ["stockTransfer", bTransfer],
    ] as const) {
      const error = await failure(findOwnedOrThrow(tenant, model, id));
      expect(error.status).toBe(404);
      expect(error.code).toBe("NOT_FOUND");
    }
  });

  it("gives a byte-identical 404 body for a missing ID and another organization's ID", async () => {
    const missing = await failure(
      findOwnedOrThrow(tenant, "warehouse", "019a0000-0000-7000-8000-000000000000"),
    );
    const foreign = await failure(findOwnedOrThrow(tenant, "warehouse", bWarehouse));
    const malformed = await failure(findOwnedOrThrow(tenant, "warehouse", "not-a-uuid"));
    expect(missing.status).toBe(foreign.status);
    expect(await bodyOf(foreign)).toBe(await bodyOf(missing));
    expect(await bodyOf(malformed)).toBe(await bodyOf(missing));
  });

  it("hides archived rows unless the caller includes them", async () => {
    const error = await failure(findOwnedOrThrow(tenant, "warehouse", aArchivedWarehouse));
    expect(error.status).toBe(404);
    const row = await findOwnedOrThrow(tenant, "warehouse", aArchivedWarehouse, {
      includeArchived: true,
    });
    expect(row.id).toBe(aArchivedWarehouse);
  });
});

describe("assertOwnedIds", () => {
  it("passes for own IDs, duplicates and an empty list", async () => {
    await assertOwnedIds(tenant, "warehouse", [aWarehouse, aWarehouse]);
    await assertOwnedIds(tenant, "product", [aProduct]);
    await assertOwnedIds(tenant, "warehouse", []);
  });

  it("throws 404 when any ID belongs to another organization", async () => {
    const error = await failure(assertOwnedIds(tenant, "warehouse", [aWarehouse, bWarehouse]));
    expect(error.status).toBe(404);
    expect((await failure(assertOwnedIds(tenant, "product", [bProduct]))).code).toBe("NOT_FOUND");
  });

  it("gives the same 404 body as findOwnedOrThrow", async () => {
    const foreign = await failure(assertOwnedIds(tenant, "warehouse", [bWarehouse]));
    const lookup = await failure(findOwnedOrThrow(tenant, "warehouse", bWarehouse));
    expect(await bodyOf(foreign)).toBe(await bodyOf(lookup));
    const malformed = await failure(assertOwnedIds(tenant, "warehouse", ["x"]));
    expect(await bodyOf(malformed)).toBe(await bodyOf(lookup));
  });

  it("rejects archived rows unless the caller includes them", async () => {
    expect((await failure(assertOwnedIds(tenant, "warehouse", [aArchivedWarehouse]))).status).toBe(
      404,
    );
    await assertOwnedIds(tenant, "warehouse", [aArchivedWarehouse], { includeArchived: true });
  });
});
