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
let aArchivedProduct: string;
let bWarehouse: string;
let bProduct: string;
let bTransfer: string;
let aTransfer: string;
let aUser: string;
let bUser: string;

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
  const archivedProduct = await prisma.product.create({
    data: { organizationId: org.id, sku: "S2", name: "P2", unit: "pcs", archivedAt: new Date() },
  });
  return { org, user, w1, archived, product, archivedProduct, transfer };
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
  aArchivedProduct = a.archivedProduct.id;
  aTransfer = a.transfer.id;
  aUser = a.user.id;
  bUser = b.user.id;
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

  it("throws 404 for a product and a stock transfer that do not exist", async () => {
    const missing = "019a0000-0000-7000-8000-000000000000";
    for (const model of ["product", "stockTransfer"] as const) {
      const error = await failure(findOwnedOrThrow(tenant, model, missing));
      expect(error.status).toBe(404);
      expect(error.code).toBe("NOT_FOUND");
    }
  });

  it("hides an archived product unless the caller includes it", async () => {
    expect((await failure(findOwnedOrThrow(tenant, "product", aArchivedProduct))).status).toBe(404);
    const row = await findOwnedOrThrow(tenant, "product", aArchivedProduct, {
      includeArchived: true,
    });
    expect(row.id).toBe(aArchivedProduct);
  });

  it("does not hide a stock transfer (it has no archivedAt), even without includeArchived", async () => {
    expect((await findOwnedOrThrow(tenant, "stockTransfer", aTransfer)).id).toBe(aTransfer);
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

describe("users", () => {
  it("findOwnedOrThrow and assertOwnedIds accept own users and give the same 404 for another organization's", async () => {
    expect((await findOwnedOrThrow(tenant, "user", aUser)).id).toBe(aUser);
    await assertOwnedIds(tenant, "user", [aUser]);
    const lookup = await failure(findOwnedOrThrow(tenant, "user", bUser));
    const asserted = await failure(assertOwnedIds(tenant, "user", [aUser, bUser]));
    expect(lookup.status).toBe(404);
    expect(await bodyOf(asserted)).toBe(await bodyOf(lookup));
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

  it("checks stock transfers: own passes, another organization's gives the same 404", async () => {
    await assertOwnedIds(tenant, "stockTransfer", [aTransfer]);
    const foreign = await failure(assertOwnedIds(tenant, "stockTransfer", [aTransfer, bTransfer]));
    const lookup = await failure(findOwnedOrThrow(tenant, "stockTransfer", bTransfer));
    expect(foreign.status).toBe(404);
    expect(await bodyOf(foreign)).toBe(await bodyOf(lookup));
  });

  it("rejects an archived product unless the caller includes it", async () => {
    expect((await failure(assertOwnedIds(tenant, "product", [aArchivedProduct]))).status).toBe(404);
    await assertOwnedIds(tenant, "product", [aArchivedProduct], { includeArchived: true });
  });

  it("rejects archived rows unless the caller includes them", async () => {
    expect((await failure(assertOwnedIds(tenant, "warehouse", [aArchivedWarehouse]))).status).toBe(
      404,
    );
    await assertOwnedIds(tenant, "warehouse", [aArchivedWarehouse], { includeArchived: true });
  });
});
