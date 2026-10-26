import { apiFetch } from "@/lib/api-client";
import { STOCK_QUERY_KEY } from "../stock/stock-api";
import type { MovementReason, MovementType } from "./movement-labels";

// Shape of GET /api/stock/movements (E4-07) and /:id (E4-08). Declared here because the server type pulls in Prisma.
export type MovementItem = {
  id: string;
  warehouseId: string;
  productId: string;
  type: MovementType;
  quantityDelta: number;
  reason: MovementReason | null;
  note: string | null;
  transferId: string | null;
  createdById: string;
  createdAt: string;
};
export type MovementPage = { items: MovementItem[]; nextCursor: string | null };

export type MovementDetail = MovementItem & {
  warehouse: { id: string; code: string; name: string };
  product: { id: string; sku: string; name: string; unit: string };
  createdBy: { id: string; name: string; role: string } | null;
  transfer: {
    id: string;
    code: string;
    fromWarehouse: { id: string; name: string | null };
    toWarehouse: { id: string; name: string | null };
  } | null;
};

// Under the stock key, so a receipt or adjustment invalidates the history as well.
export const MOVEMENTS_QUERY_KEY = [...STOCK_QUERY_KEY, "movements"] as const;

export type MovementFilters = {
  productId: string;
  warehouseId: string;
  type: string;
  from?: string;
  to?: string;
};

export function fetchMovements(filters: MovementFilters, cursor: string | null) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, cursor })) {
    if (value) query.set(key, value);
  }
  return apiFetch<MovementPage>(`/api/stock/movements?${query.toString()}`);
}

export function fetchMovement(id: string) {
  return apiFetch<MovementDetail>(`/api/stock/movements/${id}`);
}

// Names for the table: the history rows only carry ids. Archived rows are included so old rows keep a name.
type Page<T> = { items: T[]; total: number };
async function fetchAll<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const result = await apiFetch<Page<T>>(
      `${path}?page=${page}&pageSize=100&includeArchived=true`,
    );
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) return items;
  }
}

export type NameLookups = {
  warehouses: { id: string; name: string; archivedAt: string | null }[];
  products: { id: string; name: string; unit: string; archivedAt: string | null }[];
};

export async function fetchLookups(): Promise<NameLookups> {
  const [warehouses, products] = await Promise.all([
    fetchAll<NameLookups["warehouses"][number]>("/api/warehouses"),
    fetchAll<NameLookups["products"][number]>("/api/products"),
  ]);
  return { warehouses, products };
}
