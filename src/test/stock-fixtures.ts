import type { PrismaClient } from "../generated/prisma/client";
import type { RequestContext } from "../modules/platform/request-context";
import type { TwoTenants } from "./tenant-isolation/fixtures";

// Helpers for stock tests that arrange data with the plain client (as the tenant fixtures do).
export async function ownerContextOf(prisma: PrismaClient, t: TwoTenants): Promise<RequestContext> {
  const warehouses = await prisma.warehouse.findMany({
    where: { organizationId: t.a.organizationId, archivedAt: null },
    select: { id: true },
  });
  return {
    userId: t.a.users.OWNER,
    organizationId: t.a.organizationId,
    role: "OWNER",
    warehouseIds: warehouses.map((w) => w.id),
  };
}

// The second warehouse (W2) that createTwoTenants gives every tenant.
export async function secondWarehouseId(prisma: PrismaClient, t: TwoTenants): Promise<string> {
  const row = await prisma.warehouse.findFirstOrThrow({
    where: { organizationId: t.a.organizationId, code: "W2" },
  });
  return row.id;
}

export async function addWarehouse(prisma: PrismaClient, t: TwoTenants, code: string) {
  const row = await prisma.warehouse.create({
    data: { organizationId: t.a.organizationId, code, name: `Warehouse ${code}` },
  });
  return row.id;
}

export async function addProduct(prisma: PrismaClient, t: TwoTenants, sku: string) {
  const row = await prisma.product.create({
    data: { organizationId: t.a.organizationId, sku, name: sku, unit: "pcs" },
  });
  return row.id;
}

export async function seedLevel(
  prisma: PrismaClient,
  t: TwoTenants,
  warehouseId: string,
  productId: string,
  quantity: number,
) {
  await prisma.stockLevel.upsert({
    where: { warehouseId_productId: { warehouseId, productId } },
    create: { organizationId: t.a.organizationId, warehouseId, productId, quantity },
    update: { quantity },
  });
}

export async function quantityOf(prisma: PrismaClient, warehouseId: string, productId: string) {
  const row = await prisma.stockLevel.findUnique({
    where: { warehouseId_productId: { warehouseId, productId } },
  });
  return row?.quantity ?? null;
}
