import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../../lib/env";
import type { PrismaClient } from "../../generated/prisma/client";
import { assertTestDatabaseUrl, createTestPrisma } from "../../test/test-database";

// Raw SQL on purpose: the database must reject bad rows no matter which code path wrote them.

let prisma: PrismaClient;

beforeAll(() => {
  prisma = createTestPrisma(assertTestDatabaseUrl(env.TEST_DATABASE_URL));
});

beforeEach(async () => {
  assertTestDatabaseUrl(env.TEST_DATABASE_URL); // never truncate anything but a *_test database
  await prisma.$executeRaw`TRUNCATE TABLE import_jobs, stock_movements, warehouses, products,
    users, organizations RESTART IDENTITY CASCADE`;
});

afterAll(async () => {
  await prisma.$disconnect();
});

type Row = { id: string };

async function fixture() {
  const org = await prisma.$queryRaw<Row[]>`
    INSERT INTO organizations (name, slug) VALUES ('Org', 'acme') RETURNING id::text`;
  const orgId = org[0].id;
  const user = await prisma.$queryRaw<Row[]>`
    INSERT INTO users (organization_id, email, name, password_hash, role)
    VALUES (${orgId}::uuid, 'owner@acme.test', 'Test', 'hash', 'OWNER') RETURNING id::text`;
  const warehouse = await prisma.$queryRaw<Row[]>`
    INSERT INTO warehouses (organization_id, code, name) VALUES (${orgId}::uuid, 'GD-01', 'Gudang')
    RETURNING id::text`;
  const product = await prisma.$queryRaw<Row[]>`
    INSERT INTO products (organization_id, sku, name, unit)
    VALUES (${orgId}::uuid, 'SKU-1', 'Produk', 'pcs') RETURNING id::text`;
  return { orgId, userId: user[0].id, warehouseId: warehouse[0].id, productId: product[0].id };
}

type JobInput = {
  status?: "PREVIEW" | "COMMITTED" | "FAILED";
  totalRows?: number;
  errorRows?: number;
};

async function insertImportJob(orgId: string, userId: string, input: JobInput = {}) {
  const { status = "PREVIEW", totalRows = 10, errorRows = 0 } = input;
  const rows = await prisma.$queryRaw<Row[]>`
    INSERT INTO import_jobs (organization_id, file_name, status, total_rows, error_rows, rows, created_by_id)
    VALUES (${orgId}::uuid, 'stok.csv', ${status}::import_job_status, ${totalRows}, ${errorRows},
            '[]'::jsonb, ${userId}::uuid) RETURNING id::text`;
  return rows[0].id;
}

describe("import_jobs", () => {
  it("stores a clean preview and defaults error_report to empty", async () => {
    const { orgId, userId } = await fixture();
    await expect(insertImportJob(orgId, userId)).resolves.toBeTruthy();
  });

  it("rejects error_rows greater than total_rows", async () => {
    const { orgId, userId } = await fixture();
    await expect(insertImportJob(orgId, userId, { totalRows: 3, errorRows: 4 })).rejects.toThrow(
      /import_jobs_row_counts_check/,
    );
  });

  it.each([
    { totalRows: -1, errorRows: 0 },
    { totalRows: 3, errorRows: -1 },
  ])("rejects negative counts %j", async (counts) => {
    const { orgId, userId } = await fixture();
    await expect(insertImportJob(orgId, userId, counts)).rejects.toThrow(
      /import_jobs_row_counts_check/,
    );
  });

  it("rejects a COMMITTED job that still has errors (BL18)", async () => {
    const { orgId, userId } = await fixture();
    await expect(
      insertImportJob(orgId, userId, { status: "COMMITTED", totalRows: 5, errorRows: 1 }),
    ).rejects.toThrow(/import_jobs_committed_clean_check/);
  });

  it("allows a PREVIEW job with errors and a COMMITTED job without errors", async () => {
    const { orgId, userId } = await fixture();
    await expect(
      insertImportJob(orgId, userId, { status: "PREVIEW", totalRows: 5, errorRows: 2 }),
    ).resolves.toBeTruthy();
    await expect(
      insertImportJob(orgId, userId, { status: "COMMITTED", totalRows: 5, errorRows: 0 }),
    ).resolves.toBeTruthy();
  });
});

describe("stock_movements.import_job_id foreign key", () => {
  async function insertImportMovement(ctx: Awaited<ReturnType<typeof fixture>>, jobId: string) {
    await prisma.$executeRaw`
      INSERT INTO stock_movements (organization_id, warehouse_id, product_id, quantity_delta, type,
                                   import_job_id, created_by_id)
      VALUES (${ctx.orgId}::uuid, ${ctx.warehouseId}::uuid, ${ctx.productId}::uuid, 5, 'IMPORT',
              ${jobId}::uuid, ${ctx.userId}::uuid)`;
  }

  it("accepts a movement that points to an existing import job", async () => {
    const ctx = await fixture();
    const jobId = await insertImportJob(ctx.orgId, ctx.userId);
    await expect(insertImportMovement(ctx, jobId)).resolves.toBeUndefined();
  });

  it("rejects a movement that points to a missing import job", async () => {
    const ctx = await fixture();
    await expect(insertImportMovement(ctx, "00000000-0000-7000-8000-000000000000")).rejects.toThrow(
      /stock_movements_import_job_id_fkey/,
    );
  });

  it("refuses to delete an import job that movements point to (ON DELETE RESTRICT)", async () => {
    const ctx = await fixture();
    const jobId = await insertImportJob(ctx.orgId, ctx.userId);
    await insertImportMovement(ctx, jobId);
    await expect(
      prisma.$executeRaw`DELETE FROM import_jobs WHERE id = ${jobId}::uuid`,
    ).rejects.toThrow(/stock_movements_import_job_id_fkey/);
  });
});
