import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../../lib/env";
import type { PrismaClient } from "../../generated/prisma/client";
import { assertTestDatabaseUrl, createTestPrisma } from "../../test/test-database";

// These tests prove the rules Prisma cannot express, so they insert with raw SQL on purpose:
// the database must reject bad rows no matter which code path wrote them.

let prisma: PrismaClient;

beforeAll(() => {
  prisma = createTestPrisma(assertTestDatabaseUrl(env.TEST_DATABASE_URL));
});

beforeEach(async () => {
  assertTestDatabaseUrl(env.TEST_DATABASE_URL); // never truncate anything but a *_test database
  // TRUNCATE is not blocked by the immutability trigger on stock_movements (ADR 0005), so tests can clean up.
  await prisma.$executeRaw`TRUNCATE TABLE idempotency_keys, stock_movements, stock_transfers, stock_levels,
    user_warehouses, products, warehouses, subscriptions, users, plans, organizations RESTART IDENTITY CASCADE`;
});

afterAll(async () => {
  await prisma.$disconnect();
});

type Row = { id: string };

async function insertOrganization(slug = "acme") {
  const rows = await prisma.$queryRaw<Row[]>`
    INSERT INTO organizations (name, slug) VALUES (${"Org " + slug}, ${slug}) RETURNING id::text`;
  return rows[0].id;
}

async function insertUser(organizationId: string, email = "owner@acme.test", role = "OWNER") {
  const rows = await prisma.$queryRaw<Row[]>`
    INSERT INTO users (organization_id, email, name, password_hash, role)
    VALUES (${organizationId}::uuid, ${email}, 'Test', 'hash', ${role}::user_role) RETURNING id::text`;
  return rows[0].id;
}

async function insertWarehouse(organizationId: string, code = "GD-01") {
  const rows = await prisma.$queryRaw<Row[]>`
    INSERT INTO warehouses (organization_id, code, name)
    VALUES (${organizationId}::uuid, ${code}, 'Gudang') RETURNING id::text`;
  return rows[0].id;
}

async function insertProduct(organizationId: string, sku = "SKU-001", minStock = 0) {
  const rows = await prisma.$queryRaw<Row[]>`
    INSERT INTO products (organization_id, sku, name, unit, min_stock)
    VALUES (${organizationId}::uuid, ${sku}, 'Produk', 'pcs'::product_unit, ${minStock}) RETURNING id::text`;
  return rows[0].id;
}

async function insertStockLevel(
  orgId: string,
  warehouseId: string,
  productId: string,
  quantity = 0,
) {
  await prisma.$executeRaw`
    INSERT INTO stock_levels (organization_id, warehouse_id, product_id, quantity)
    VALUES (${orgId}::uuid, ${warehouseId}::uuid, ${productId}::uuid, ${quantity})`;
}

async function insertTransfer(
  orgId: string,
  fromId: string,
  toId: string,
  createdById: string,
  code = "MT-0001",
) {
  const rows = await prisma.$queryRaw<Row[]>`
    INSERT INTO stock_transfers (organization_id, code, from_warehouse_id, to_warehouse_id, created_by_id)
    VALUES (${orgId}::uuid, ${code}, ${fromId}::uuid, ${toId}::uuid, ${createdById}::uuid) RETURNING id::text`;
  return rows[0].id;
}

type MovementInput = {
  orgId: string;
  warehouseId: string;
  productId: string;
  createdById: string;
  delta?: number;
  type?: string;
  transferId?: string | null;
  importJobId?: string | null;
  reason?: string | null;
};

async function insertMovement(input: MovementInput) {
  const { orgId, warehouseId, productId, createdById } = input;
  const { delta = 5, type = "RECEIVE", transferId = null, importJobId = null } = input;
  const { reason = null } = input;
  const rows = await prisma.$queryRaw<Row[]>`
    INSERT INTO stock_movements (organization_id, warehouse_id, product_id, quantity_delta, type,
                                 transfer_id, import_job_id, reason, created_by_id)
    VALUES (${orgId}::uuid, ${warehouseId}::uuid, ${productId}::uuid, ${delta},
            ${type}::stock_movement_type, ${transferId}::uuid, ${importJobId}::uuid,
            ${reason}::stock_movement_reason, ${createdById}::uuid) RETURNING id::text`;
  return rows[0].id;
}

// Shared fixture: one organization with an owner, two warehouses and a product.
async function fixture() {
  const orgId = await insertOrganization();
  const userId = await insertUser(orgId);
  const warehouseA = await insertWarehouse(orgId, "GD-01");
  const warehouseB = await insertWarehouse(orgId, "GD-02");
  const productId = await insertProduct(orgId);
  return { orgId, userId, warehouseA, warehouseB, productId };
}

describe("warehouses", () => {
  it("rejects a duplicate code in the same organization", async () => {
    const orgId = await insertOrganization();
    await insertWarehouse(orgId, "GD-01");
    await expect(insertWarehouse(orgId, "GD-01")).rejects.toThrow(
      /warehouses_organization_id_code_key/,
    );
  });

  it("allows the same code in another organization", async () => {
    const orgA = await insertOrganization("orga");
    const orgB = await insertOrganization("orgb");
    await insertWarehouse(orgA, "GD-01");
    await expect(insertWarehouse(orgB, "GD-01")).resolves.toBeTruthy();
  });

  it.each(["gd-01", "Gd-01", ""])("rejects the code %j (uppercase and not empty)", async (code) => {
    const orgId = await insertOrganization();
    await expect(insertWarehouse(orgId, code)).rejects.toThrow(/warehouses_code_format_check/);
  });
});

describe("products", () => {
  it("rejects a duplicate sku in the same organization, allows it in another", async () => {
    const orgA = await insertOrganization("orga");
    const orgB = await insertOrganization("orgb");
    await insertProduct(orgA, "SKU-1");
    await expect(insertProduct(orgA, "SKU-1")).rejects.toThrow(/products_organization_id_sku_key/);
    await expect(insertProduct(orgB, "SKU-1")).resolves.toBeTruthy();
  });

  it.each(["sku-1", "SKU 1", " SKU1", ""])("rejects the sku %j", async (sku) => {
    const orgId = await insertOrganization();
    await expect(insertProduct(orgId, sku)).rejects.toThrow(/products_sku_format_check/);
  });

  it("rejects a negative min_stock", async () => {
    const orgId = await insertOrganization();
    await expect(insertProduct(orgId, "SKU-1", -1)).rejects.toThrow(/products_min_stock_check/);
  });

  it("defaults min_stock to 0 and rejects a unit outside the fixed list", async () => {
    const orgId = await insertOrganization();
    const rows = await prisma.$queryRaw<{ min_stock: number }[]>`
      INSERT INTO products (organization_id, sku, name, unit)
      VALUES (${orgId}::uuid, 'SKU-1', 'Produk', 'pcs') RETURNING min_stock`;
    expect(rows[0].min_stock).toBe(0);
    await expect(
      prisma.$executeRaw`INSERT INTO products (organization_id, sku, name, unit)
        VALUES (${orgId}::uuid, 'SKU-2', 'Produk', 'kg')`,
    ).rejects.toThrow(/product_unit/);
  });
});

describe("user_warehouses", () => {
  it("rejects the same (user, warehouse) pair twice", async () => {
    const { orgId, userId, warehouseA } = await fixture();
    const insert = () =>
      prisma.$executeRaw`INSERT INTO user_warehouses (user_id, warehouse_id, organization_id)
        VALUES (${userId}::uuid, ${warehouseA}::uuid, ${orgId}::uuid)`;
    await insert();
    await expect(insert()).rejects.toThrow(/user_warehouses_pkey/);
  });
});

describe("stock_levels", () => {
  it("rejects a negative quantity (last safety net for BL13)", async () => {
    const { orgId, warehouseA, productId } = await fixture();
    await expect(insertStockLevel(orgId, warehouseA, productId, -1)).rejects.toThrow(
      /stock_levels_quantity_check/,
    );
  });

  it("rejects an update that would make the quantity negative", async () => {
    const { orgId, warehouseA, productId } = await fixture();
    await insertStockLevel(orgId, warehouseA, productId, 3);
    await expect(
      prisma.$executeRaw`UPDATE stock_levels SET quantity = quantity - 4`,
    ).rejects.toThrow(/stock_levels_quantity_check/);
  });

  it("rejects a second row for the same (warehouse, product)", async () => {
    const { orgId, warehouseA, productId } = await fixture();
    await insertStockLevel(orgId, warehouseA, productId, 1);
    await expect(insertStockLevel(orgId, warehouseA, productId, 1)).rejects.toThrow(
      /stock_levels_warehouse_id_product_id_key/,
    );
  });
});

describe("stock_transfers", () => {
  it("rejects a transfer to the same warehouse (BL13)", async () => {
    const { orgId, userId, warehouseA } = await fixture();
    await expect(insertTransfer(orgId, warehouseA, warehouseA, userId)).rejects.toThrow(
      /stock_transfers_distinct_warehouses_check/,
    );
  });

  it("rejects a duplicate code in the same organization", async () => {
    const { orgId, userId, warehouseA, warehouseB } = await fixture();
    await insertTransfer(orgId, warehouseA, warehouseB, userId, "MT-0001");
    await expect(insertTransfer(orgId, warehouseB, warehouseA, userId, "MT-0001")).rejects.toThrow(
      /stock_transfers_organization_id_code_key/,
    );
  });
});

describe("stock_movements", () => {
  it("accepts a plain RECEIVE movement", async () => {
    const f = await fixture();
    await expect(
      insertMovement({ ...f, createdById: f.userId, warehouseId: f.warehouseA }),
    ).resolves.toBeTruthy();
  });

  it("rejects a zero delta", async () => {
    const f = await fixture();
    await expect(
      insertMovement({ ...f, createdById: f.userId, warehouseId: f.warehouseA, delta: 0 }),
    ).rejects.toThrow(/stock_movements_delta_nonzero_check/);
  });

  describe("delta sign per type", () => {
    it.each([
      ["RECEIVE", -5],
      ["IMPORT", -5],
    ])("rejects a negative delta for %s", async (type, delta) => {
      const f = await fixture();
      await expect(
        insertMovement({ ...f, createdById: f.userId, warehouseId: f.warehouseA, type, delta }),
      ).rejects.toThrow(/stock_movements_delta_sign_check/);
    });

    it("rejects a positive TRANSFER_OUT and a negative TRANSFER_IN", async () => {
      const f = await fixture();
      const transferId = await insertTransfer(f.orgId, f.warehouseA, f.warehouseB, f.userId);
      const base = { ...f, createdById: f.userId, transferId };
      await expect(
        insertMovement({ ...base, warehouseId: f.warehouseA, type: "TRANSFER_OUT", delta: 5 }),
      ).rejects.toThrow(/stock_movements_delta_sign_check/);
      await expect(
        insertMovement({ ...base, warehouseId: f.warehouseB, type: "TRANSFER_IN", delta: -5 }),
      ).rejects.toThrow(/stock_movements_delta_sign_check/);
    });

    it("accepts both signs for ADJUST", async () => {
      const f = await fixture();
      const base = {
        ...f,
        createdById: f.userId,
        warehouseId: f.warehouseA,
        type: "ADJUST",
        reason: "DAMAGED",
      };
      await expect(insertMovement({ ...base, delta: -2 })).resolves.toBeTruthy();
      await expect(insertMovement({ ...base, delta: 2 })).resolves.toBeTruthy();
    });
  });

  describe("type-specific fields", () => {
    it("requires transfer_id for TRANSFER_OUT and TRANSFER_IN", async () => {
      const f = await fixture();
      await expect(
        insertMovement({
          ...f,
          createdById: f.userId,
          warehouseId: f.warehouseA,
          type: "TRANSFER_OUT",
          delta: -1,
        }),
      ).rejects.toThrow(/stock_movements_type_fields_check/);
    });

    it("forbids transfer_id on other types", async () => {
      const f = await fixture();
      const transferId = await insertTransfer(f.orgId, f.warehouseA, f.warehouseB, f.userId);
      await expect(
        insertMovement({ ...f, createdById: f.userId, warehouseId: f.warehouseA, transferId }),
      ).rejects.toThrow(/stock_movements_type_fields_check/);
    });

    it("requires a reason for ADJUST (BL12) and forbids it on other types", async () => {
      const f = await fixture();
      const base = { ...f, createdById: f.userId, warehouseId: f.warehouseA };
      await expect(insertMovement({ ...base, type: "ADJUST", delta: -1 })).rejects.toThrow(
        /stock_movements_type_fields_check/,
      );
      await expect(insertMovement({ ...base, reason: "LOST" })).rejects.toThrow(
        /stock_movements_type_fields_check/,
      );
    });

    it("allows import_job_id only for IMPORT, without requiring it", async () => {
      const f = await fixture();
      const base = { ...f, createdById: f.userId, warehouseId: f.warehouseA };
      const jobs = await prisma.$queryRaw<Row[]>`
        INSERT INTO import_jobs (organization_id, file_name, total_rows, error_rows, rows, created_by_id)
        VALUES (${f.orgId}::uuid, 'stok.csv', 1, 0, '[]'::jsonb, ${f.userId}::uuid) RETURNING id::text`;
      const jobId = jobs[0].id;
      await expect(insertMovement({ ...base, type: "IMPORT" })).resolves.toBeTruthy();
      await expect(
        insertMovement({ ...base, type: "IMPORT", importJobId: jobId }),
      ).resolves.toBeTruthy();
      await expect(insertMovement({ ...base, importJobId: jobId })).rejects.toThrow(
        /stock_movements_type_fields_check/,
      );
    });
  });

  describe("immutability (ADR 0005)", () => {
    it("rejects UPDATE", async () => {
      const f = await fixture();
      await insertMovement({ ...f, createdById: f.userId, warehouseId: f.warehouseA });
      await expect(
        prisma.$executeRaw`UPDATE stock_movements SET quantity_delta = 99`,
      ).rejects.toThrow(/stock_movements are immutable/);
    });

    it("rejects DELETE", async () => {
      const f = await fixture();
      await insertMovement({ ...f, createdById: f.userId, warehouseId: f.warehouseA });
      await expect(prisma.$executeRaw`DELETE FROM stock_movements`).rejects.toThrow(
        /stock_movements are immutable/,
      );
    });

    it("does not block TRUNCATE, which the tests use for cleanup", async () => {
      const f = await fixture();
      await insertMovement({ ...f, createdById: f.userId, warehouseId: f.warehouseA });
      await prisma.$executeRaw`TRUNCATE TABLE stock_movements`;
      const rows = await prisma.$queryRaw<
        { count: number }[]
      >`SELECT count(*)::int AS count FROM stock_movements`;
      expect(rows[0].count).toBe(0);
    });
  });
});

describe("idempotency_keys", () => {
  async function insertKey(orgId: string, key: string, endpoint: string) {
    await prisma.$executeRaw`
      INSERT INTO idempotency_keys (organization_id, key, endpoint, resource_id)
      VALUES (${orgId}::uuid, ${key}, ${endpoint}, uuidv7())`;
  }

  it("rejects the same (organization, key, endpoint) twice (BL14)", async () => {
    const orgId = await insertOrganization();
    await insertKey(orgId, "k1", "POST /api/transfers");
    await expect(insertKey(orgId, "k1", "POST /api/transfers")).rejects.toThrow(
      /idempotency_keys_pkey/,
    );
  });

  it("allows the same key for another endpoint or another organization", async () => {
    const orgA = await insertOrganization("orga");
    const orgB = await insertOrganization("orgb");
    await insertKey(orgA, "k1", "POST /api/transfers");
    await expect(insertKey(orgA, "k1", "POST /api/receipts")).resolves.toBeUndefined();
    await expect(insertKey(orgB, "k1", "POST /api/transfers")).resolves.toBeUndefined();
  });
});

describe("foreign keys are RESTRICT (archive, never delete)", () => {
  it("rejects deleting a warehouse or product that still has stock", async () => {
    const { orgId, warehouseA, productId } = await fixture();
    await insertStockLevel(orgId, warehouseA, productId, 1);
    await expect(
      prisma.$executeRaw`DELETE FROM warehouses WHERE id = ${warehouseA}::uuid`,
    ).rejects.toThrow(/stock_levels_warehouse_id_fkey/);
    await expect(
      prisma.$executeRaw`DELETE FROM products WHERE id = ${productId}::uuid`,
    ).rejects.toThrow(/stock_levels_product_id_fkey/);
  });

  it("rejects deleting an organization that owns warehouses", async () => {
    const { orgId } = await fixture();
    await expect(
      prisma.$executeRaw`DELETE FROM organizations WHERE id = ${orgId}::uuid`,
    ).rejects.toThrow(/_organization_id_fkey/);
  });
});
