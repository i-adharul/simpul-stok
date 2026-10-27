import type { Prisma } from "../../generated/prisma/client";
import { authorize } from "../platform/can";
import type { RequestContext } from "../platform/request-context";
import type { TenantClient } from "../platform/tenant-client";
import type { ListStockQuery, StockStatus } from "./stock-schema";
import { buildStatusWhere, stockStatusOf } from "./stock-status";

// Filters shared by the page and the summary counts: everything except `status`.
function baseWhere(ctx: RequestContext, q: ListStockQuery): Prisma.StockLevelWhereInput {
  const and: Prisma.StockLevelWhereInput[] = [
    // Scope (BL16): an Owner has every active warehouse, the others their assigned ones.
    { warehouseId: q.warehouseId ? q.warehouseId : { in: ctx.warehouseIds } },
    // An archived product only shows while it still has stock, so the stock can be zeroed (BL09).
    { OR: [{ product: { archivedAt: null } }, { quantity: { gt: 0 } }] },
  ];
  if (q.productId) and.push({ productId: q.productId });
  if (q.q) {
    and.push({
      product: {
        OR: [
          { sku: { contains: q.q, mode: "insensitive" } },
          { name: { contains: q.q, mode: "insensitive" } },
        ],
      },
    });
  }
  return { AND: and };
}

// GET /api/stock (E4-06). One row per (warehouse, product) pair that HAS a stock row; pairs without a
// row are not returned. Names come from separate tenant-client reads, like getMovement.
export async function listStock(db: TenantClient, ctx: RequestContext, q: ListStockQuery) {
  // A requested warehouse is judged first: 403, the same for a foreign and a missing id.
  if (q.warehouseId) authorize(ctx, "stock.read", { warehouseId: q.warehouseId });
  const minStocks = (await db.product.groupBy({ by: ["minStock"] })).map((g) => g.minStock);
  const base = baseWhere(ctx, q);
  const withStatus = (status: StockStatus): Prisma.StockLevelWhereInput => ({
    AND: [base, buildStatusWhere(status, minStocks)],
  });

  const [out, low, ok, rows] = await Promise.all([
    db.stockLevel.count({ where: withStatus("OUT") }),
    db.stockLevel.count({ where: withStatus("LOW") }),
    db.stockLevel.count({ where: withStatus("OK") }),
    db.stockLevel.findMany({
      where: q.status ? withStatus(q.status) : base,
      orderBy: [
        { product: { name: "asc" } },
        { warehouse: { code: "asc" } },
        { warehouseId: "asc" },
        { productId: "asc" },
      ],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  const summary = { out, low, ok };
  const total = q.status ? summary[q.status.toLowerCase() as "out" | "low" | "ok"] : out + low + ok;

  const [warehouses, products] = await Promise.all([
    db.warehouse.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.warehouseId))] } } }),
    db.product.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.productId))] } } }),
  ]);
  const warehouseOf = new Map(warehouses.map((w) => [w.id, w]));
  const productOf = new Map(products.map((p) => [p.id, p]));

  const items = rows.flatMap((row) => {
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
          archived: product.archivedAt !== null,
        },
        quantity: row.quantity,
        status: stockStatusOf(row.quantity, product.minStock),
        updatedAt: row.updatedAt.toISOString(),
      },
    ];
  });
  return { items, total, page: q.page, pageSize: q.pageSize, summary };
}
