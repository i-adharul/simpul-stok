import type { RequestContext } from "../platform/request-context";
import type { TenantClient } from "../platform/tenant-client";
import type { Prisma } from "../../generated/prisma/client";
import { buildStatusWhere, stockStatusOf } from "./stock-status";

// E6-01 decision: 5 restock rows and 5 activity rows (S04 design).
const LIST_SIZE = 5;
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// 00:00 WIB of the WIB calendar day that contains `now`, as a UTC instant. WIB has no daylight saving,
// so a fixed +7h shift is exact.
export function wibDayStart(now: Date): Date {
  const shifted = now.getTime() + WIB_OFFSET_MS;
  return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - WIB_OFFSET_MS);
}

// The (warehouse, product) pairs that are OUT or LOW, ordered by quantity - minStock (lowest first).
// Prisma cannot order by a difference of two tables' columns and raw SQL is not allowed here. Within
// one minStock value the order by quantity IS the order by the difference, so take the top rows of each
// distinct minStock and merge: exact, and at most LIST_SIZE x (distinct minStock values) rows are read.
async function lowestByGap(
  db: TenantClient,
  scope: Prisma.StockLevelWhereInput,
  minStocks: readonly number[],
) {
  const groups = await Promise.all(
    minStocks.map(async (minStock) => {
      const rows = await db.stockLevel.findMany({
        where: {
          AND: [scope, { product: { minStock } }, { quantity: { lt: Math.max(minStock, 1) } }],
        },
        orderBy: [{ quantity: "asc" }, { warehouseId: "asc" }, { productId: "asc" }],
        take: LIST_SIZE,
      });
      return rows.map((row) => ({ row, minStock }));
    }),
  );
  return groups
    .flat()
    .sort(
      (a, b) =>
        a.row.quantity - a.minStock - (b.row.quantity - b.minStock) ||
        a.row.warehouseId.localeCompare(b.row.warehouseId) ||
        a.row.productId.localeCompare(b.row.productId),
    )
    .slice(0, LIST_SIZE);
}

// GET /api/dashboard (S04, BL16). Reads the database directly (no cache). Every figure except
// totalProducts (organization-wide, active products) is limited to ctx.warehouseIds, so a Warehouse Admin
// or Viewer never sees stock numbers of other warehouses. totalUnits also counts archived products' units.
export async function getDashboard(db: TenantClient, ctx: RequestContext, now: Date = new Date()) {
  const inScope: Prisma.StockLevelWhereInput = { warehouseId: { in: ctx.warehouseIds } };
  // Archived products are not restocked, so they are left out of the status counts and the list.
  const active: Prisma.StockLevelWhereInput = { AND: [inScope, { product: { archivedAt: null } }] };
  const minStocks = (await db.product.groupBy({ by: ["minStock"] })).map((g) => g.minStock);
  const dayStart = wibDayStart(now);

  const [totalProducts, units, outCount, lowCount, movementsToday, lowest, latest] =
    await Promise.all([
      db.product.count({ where: { archivedAt: null } }),
      db.stockLevel.aggregate({ where: inScope, _sum: { quantity: true } }),
      db.stockLevel.count({ where: { AND: [active, buildStatusWhere("OUT", minStocks)] } }),
      db.stockLevel.count({ where: { AND: [active, buildStatusWhere("LOW", minStocks)] } }),
      db.stockMovement.count({
        where: {
          warehouseId: { in: ctx.warehouseIds },
          createdAt: { gte: dayStart, lt: new Date(dayStart.getTime() + DAY_MS) },
        },
      }),
      lowestByGap(db, active, minStocks),
      db.stockMovement.findMany({
        where: { warehouseId: { in: ctx.warehouseIds } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: LIST_SIZE,
      }),
    ]);

  // Names come from separate tenant-client reads, like getMovement.
  const shown = [...lowest.map((l) => l.row), ...latest];
  const warehouseIds = [...new Set(shown.map((r) => r.warehouseId))];
  const productIds = [...new Set(shown.map((r) => r.productId))];
  const [warehouses, products, users, transfers] = await Promise.all([
    db.warehouse.findMany({ where: { id: { in: warehouseIds } } }),
    db.product.findMany({ where: { id: { in: productIds } } }),
    db.user.findMany({ where: { id: { in: [...new Set(latest.map((m) => m.createdById))] } } }),
    db.stockTransfer.findMany({
      where: {
        id: { in: [...new Set(latest.flatMap((m) => (m.transferId ? [m.transferId] : [])))] },
      },
    }),
  ]);
  const warehouseOf = new Map(warehouses.map((w) => [w.id, w]));
  const productOf = new Map(products.map((p) => [p.id, p]));
  const userOf = new Map(users.map((u) => [u.id, u]));
  const transferOf = new Map(transfers.map((x) => [x.id, x]));

  const restockItems = lowest.flatMap(({ row }) => {
    const warehouse = warehouseOf.get(row.warehouseId);
    const product = productOf.get(row.productId);
    if (!warehouse || !product) return [];
    return [
      {
        warehouse: { id: warehouse.id, code: warehouse.code, name: warehouse.name },
        product: {
          id: product.id,
          sku: product.sku,
          name: product.name,
          unit: product.unit,
          minStock: product.minStock,
        },
        quantity: row.quantity,
        status: stockStatusOf(row.quantity, product.minStock),
      },
    ];
  });

  const recentActivity = latest.flatMap((m) => {
    const warehouse = warehouseOf.get(m.warehouseId);
    const product = productOf.get(m.productId);
    if (!warehouse || !product) return [];
    const creator = userOf.get(m.createdById);
    const transfer = m.transferId ? transferOf.get(m.transferId) : undefined;
    return [
      {
        id: m.id,
        type: m.type,
        quantityDelta: m.quantityDelta,
        reason: m.reason,
        createdAt: m.createdAt.toISOString(),
        warehouse: { id: warehouse.id, code: warehouse.code, name: warehouse.name },
        product: { id: product.id, sku: product.sku, name: product.name, unit: product.unit },
        // id and name only, never the email (as S06).
        createdBy: creator ? { id: creator.id, name: creator.name } : null,
        transfer: transfer ? { id: transfer.id, code: transfer.code } : null,
      },
    ];
  });

  return {
    summary: {
      totalProducts,
      totalUnits: units._sum.quantity ?? 0,
      lowCount,
      outCount,
      movementsToday,
    },
    restock: { items: restockItems, total: outCount + lowCount },
    recentActivity,
  };
}
