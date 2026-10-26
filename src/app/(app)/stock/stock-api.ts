import { apiFetch } from "@/lib/api-client";
import type { Product } from "../products/product-api";
import type { Warehouse } from "../warehouses/warehouse-api";
import type { StockReceiveValues } from "./stock-receive-schema";

// Every stock query lives under this key; a stock write invalidates it so S04, S06, S08 and S09 reload.
export const STOCK_QUERY_KEY = ["stock"] as const;
export const RECEIVE_OPTIONS_KEY = [...STOCK_QUERY_KEY, "receive-options"] as const;

// POST /api/stock/receive answers with the movement, never the current stock.
export type ReceiveResult = {
  id: string;
  warehouseId: string;
  productId: string;
  quantity: number;
  createdAt: string;
};

// The key is made when the dialog opens and kept until the receipt succeeds, so a double click or a
// retry after a timeout sends the same key and the server applies it once (ADR 0012).
export function receiveStock(idempotencyKey: string, values: StockReceiveValues) {
  return apiFetch<ReceiveResult>("/api/stock/receive", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(values),
  });
}

type Page<T> = { items: T[]; total: number };

async function fetchAll<T>(path: string): Promise<T[]> {
  const pageSize = 100;
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const result = await apiFetch<Page<T>>(`${path}?page=${page}&pageSize=${pageSize}`);
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) return items;
  }
}

// The lists hide archived rows by default. The warehouse list already holds only the warehouses the
// user is assigned to (Owner: all), so a Warehouse Admin never sees one they cannot write to.
export async function fetchReceiveOptions(): Promise<{
  warehouses: Warehouse[];
  products: Product[];
}> {
  const [warehouses, products] = await Promise.all([
    fetchAll<Warehouse>("/api/warehouses"),
    fetchAll<Product>("/api/products"),
  ]);
  return { warehouses, products };
}

// BL: only Owner and Warehouse Admin receive stock (the Viewer only reads).
export function canReceiveStock(role: string | undefined): boolean {
  return role === "OWNER" || role === "WAREHOUSE_ADMIN";
}
