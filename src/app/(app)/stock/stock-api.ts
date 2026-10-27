import { apiFetch } from "@/lib/api-client";
import type { Product } from "../products/product-api";
import type { Warehouse } from "../warehouses/warehouse-api";
import type { StockAdjustValues } from "./stock-adjust-schema";
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

// POST /api/stock/adjust answers with the movement (quantity = the signed difference), never the stock.
export type AdjustResult = ReceiveResult & { reason: string };

// Same key rule as receiveStock: one key per opened form, reused on a retry (ADR 0012).
export function adjustStock(idempotencyKey: string, values: StockAdjustValues) {
  return apiFetch<AdjustResult>("/api/stock/adjust", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(values),
  });
}

// BL12: same roles as a receipt (the Viewer only reads).
export const canAdjustStock = canReceiveStock;

export type StockStatus = "OUT" | "LOW" | "OK";

// Shape of GET /api/stock (E4-06). Declared here because the server type pulls in Prisma.
export type StockRow = {
  warehouse: { id: string; code: string; name: string };
  product: {
    id: string;
    sku: string;
    name: string;
    unit: string;
    minStock: number;
    archived: boolean;
  };
  quantity: number;
  status: StockStatus;
  updatedAt: string;
};
export type StockPage = {
  items: StockRow[];
  total: number;
  page: number;
  pageSize: number;
  summary: { out: number; low: number; ok: number };
};
export type StockFilters = { warehouseId: string; q: string; status: StockStatus | "" };
export const STOCK_PAGE_SIZE = 20;

export function fetchStockPage(filters: StockFilters, page: number) {
  const query = new URLSearchParams({ page: String(page), pageSize: String(STOCK_PAGE_SIZE) });
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
  return apiFetch<StockPage>(`/api/stock?${query.toString()}`);
}

export const STOCK_WAREHOUSES_KEY = [...STOCK_QUERY_KEY, "warehouse-options"] as const;
export const fetchWarehouseOptions = () => fetchAll<Warehouse>("/api/warehouses");
