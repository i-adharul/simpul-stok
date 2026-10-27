import type { Prisma } from "../../generated/prisma/client";
import type { StockStatus } from "./stock-schema";

// BL15 / S09 definition, judged against the minimum of the pair's own product:
//   OUT  quantity = 0
//   LOW  quantity > 0 and quantity < minStock   (so minStock 0 and 1 are never LOW)
//   OK   quantity > 0 and quantity >= minStock
export function stockStatusOf(quantity: number, minStock: number): StockStatus {
  if (quantity === 0) return "OUT";
  return quantity < minStock ? "LOW" : "OK";
}

// The same definition as a database filter, so total and pages never depend on filtering in memory.
// minStock lives on the product, and Prisma cannot compare two columns of different tables, so there
// is one OR branch per DISTINCT minStock value of the organization (usually a handful). No raw SQL.
// With no branch the filter must match nothing; an empty OR is not safe for that, so it is spelled out.
// E6-01 (dashboard) reuses this.
const NOTHING: Prisma.StockLevelWhereInput = { id: { in: [] } };
const anyOf = (branches: Prisma.StockLevelWhereInput[]): Prisma.StockLevelWhereInput =>
  branches.length > 0 ? { OR: branches } : NOTHING;

export function buildStatusWhere(
  status: StockStatus,
  minStocks: readonly number[],
): Prisma.StockLevelWhereInput {
  if (status === "OUT") return { quantity: 0 };
  if (status === "LOW") {
    return anyOf(
      minStocks
        .filter((m) => m >= 2)
        .map((m) => ({ product: { minStock: m }, quantity: { gt: 0, lt: m } })),
    );
  }
  return anyOf(
    minStocks.map((m) => ({ product: { minStock: m }, quantity: { gte: Math.max(m, 1) } })),
  );
}
