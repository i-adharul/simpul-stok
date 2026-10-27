import { createHash } from "node:crypto";
import type { PrismaClient } from "../src/generated/prisma/client";
import { createTenantClient, type TenantClient } from "../src/modules/platform/tenant-client";
import type { RequestContext } from "../src/modules/platform/request-context";
import { DEMO_ORGANIZATION, seedBase, type SeedOptions } from "../src/modules/platform/seed";
import { adjustStock } from "../src/modules/stock/stock-adjust-service";
import { receiveStock } from "../src/modules/stock/stock-service";
import { transferStock } from "../src/modules/stock/stock-transfer-service";
import { createProduct } from "../src/modules/stock/product-service";
import { createWarehouse } from "../src/modules/stock/warehouse-service";
import { replaceWarehouseMembers } from "../src/modules/stock/warehouse-members-service";
import {
  DEMO_ADJUSTMENTS,
  DEMO_ASSIGNMENTS,
  DEMO_PRODUCTS,
  DEMO_RECEIPTS,
  DEMO_TRANSFERS,
  DEMO_WAREHOUSES,
} from "./demo-data";

// Demo data THROUGH THE SERVICES (E6-03), not raw inserts: stock levels and the movement ledger
// come from the same code the API runs, so they always agree. Safe to run twice: warehouses and
// products are looked up first, and stock operations carry a key derived from their name, so the
// second run replays them (ADR 0012) and writes nothing.
// This file is a bootstrap script like seed.ts: the plain client is needed to find the Owner and to
// build the tenant client (eslint.config.mjs allowlist). Everything else goes through that client.

// A UUID (version 5 layout) made from a stable name: same name, same key, on every run.
export function demoKey(name: string): string {
  const bytes = createHash("sha1").update(`simpul-demo-seed:${name}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const h = bytes.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export async function seedDemo(prisma: PrismaClient, options: SeedOptions = {}): Promise<void> {
  await seedBase(prisma, options);
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { slug: DEMO_ORGANIZATION.slug },
  });
  const owner = await prisma.user.findFirstOrThrow({
    where: { organizationId: organization.id, role: "OWNER" },
  });
  const base: RequestContext = {
    userId: owner.id,
    organizationId: organization.id,
    role: "OWNER",
    warehouseIds: [],
  };

  const warehouseIds = await ensureWarehouses(createTenantClient(prisma, base), base);
  const ctx: RequestContext = { ...base, warehouseIds: [...warehouseIds.values()] };
  const db = createTenantClient(prisma, ctx);
  const productIds = await ensureProducts(db, ctx);
  const userIds = await emailToUserId(prisma, organization.id);

  for (const warehouse of DEMO_WAREHOUSES) {
    const members = DEMO_ASSIGNMENTS[warehouse.code].map((email) => userIds.get(email)!);
    await replaceWarehouseMembers(
      db,
      ctx.organizationId,
      warehouseIds.get(warehouse.code)!,
      members,
    );
  }
  await runStockOperations(db, ctx, warehouseIds, productIds);
}

type Ids = Map<string, string>;

async function ensureWarehouses(db: TenantClient, ctx: RequestContext): Promise<Ids> {
  const ids: Ids = new Map();
  for (const data of DEMO_WAREHOUSES) {
    const row =
      (await db.warehouse.findFirst({ where: { code: data.code } })) ??
      (await createWarehouse(db, ctx, data));
    ids.set(data.code, row.id);
  }
  return ids;
}

async function ensureProducts(db: TenantClient, ctx: RequestContext): Promise<Ids> {
  const ids: Ids = new Map();
  for (const data of DEMO_PRODUCTS) {
    const row =
      (await db.product.findFirst({ where: { sku: data.sku } })) ??
      (await createProduct(db, ctx, data));
    ids.set(data.sku, row.id);
  }
  return ids;
}

async function emailToUserId(prisma: PrismaClient, organizationId: string): Promise<Ids> {
  const users = await prisma.user.findMany({ where: { organizationId } });
  return new Map(users.map((user) => [user.email, user.id]));
}

// Order matters: receipts first, then adjustments, then transfers that move what the receipts created.
async function runStockOperations(
  db: TenantClient,
  ctx: RequestContext,
  warehouses: Ids,
  products: Ids,
): Promise<void> {
  for (const r of DEMO_RECEIPTS) {
    await receiveStock(db, ctx, demoKey(r.name), {
      warehouseId: warehouses.get(r.warehouse)!,
      productId: products.get(r.sku)!,
      quantity: r.quantity,
      note: r.note,
    });
  }
  for (const a of DEMO_ADJUSTMENTS) {
    await adjustStock(db, ctx, demoKey(a.name), {
      ...a.body,
      warehouseId: warehouses.get(a.warehouse)!,
      productId: products.get(a.sku)!,
    });
  }
  for (const t of DEMO_TRANSFERS) {
    await transferStock(db, ctx, demoKey(t.name), {
      fromWarehouseId: warehouses.get(t.from)!,
      toWarehouseId: warehouses.get(t.to)!,
      items: t.items.map((item) => ({
        productId: products.get(item.sku)!,
        quantity: item.quantity,
      })),
      note: t.note,
    });
  }
}
