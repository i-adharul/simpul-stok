import { apiFetch } from "@/lib/api-client";
import { STOCK_QUERY_KEY, type StockRow } from "../stock/stock-api";
import type { TransferPayload } from "./transfer-schema";

// Shape of GET /api/stock/transfers/:id (E5-05). Declared here because the server type pulls in Prisma.
// A movement id is null when the user may not see that warehouse (P13 would answer 404).
export type TransferWarehouse = { id: string; code: string; name: string; address: string | null };
export type TransferItem = {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  outMovementId: string | null;
  inMovementId: string | null;
};
export type TransferDetailData = {
  id: string;
  code: string;
  note: string | null;
  createdAt: string;
  createdBy: { id: string; name: string; role: string } | null;
  fromWarehouse: TransferWarehouse;
  toWarehouse: TransferWarehouse;
  items: TransferItem[];
};

export const transferKey = (id: string) => [...STOCK_QUERY_KEY, "transfer", id] as const;

export function fetchTransfer(id: string) {
  return apiFetch<TransferDetailData>(`/api/stock/transfers/${id}`);
}

// POST /api/stock/transfers (E5-04). The key follows the payload (nextIdempotencyKey), so a retry of the
// same request is applied once (ADR 0012).
export type CreatedTransfer = { id: string; code: string };

export function createTransfer(idempotencyKey: string, payload: TransferPayload) {
  return apiFetch<CreatedTransfer>("/api/stock/transfers", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload),
  });
}

// Every active warehouse of the organization except the chosen source is a valid destination (BL13).
export type TransferDestination = { id: string; code: string; name: string };
export const TRANSFER_DESTINATIONS_KEY = [...STOCK_QUERY_KEY, "transfer-destinations"] as const;

export async function fetchTransferDestinations(): Promise<TransferDestination[]> {
  const result = await apiFetch<{ items: TransferDestination[] }>(
    "/api/stock/transfers/destinations",
  );
  return result.items;
}

// The quantity each product has in the source, shown next to its row. A product with no stock row has 0.
export const sourceStockKey = (warehouseId: string) =>
  [...STOCK_QUERY_KEY, "transfer-source", warehouseId] as const;

export async function fetchSourceStock(warehouseId: string): Promise<Map<string, number>> {
  const pageSize = 100;
  const available = new Map<string, number>();
  for (let page = 1; ; page++) {
    const result = await apiFetch<{ items: StockRow[]; total: number }>(
      `/api/stock?warehouseId=${warehouseId}&page=${page}&pageSize=${pageSize}`,
    );
    for (const row of result.items) available.set(row.product.id, row.quantity);
    if (page * pageSize >= result.total || result.items.length === 0) return available;
  }
}

export const TRANSFER_PRODUCTS_KEY = [...STOCK_QUERY_KEY, "transfer-products"] as const;
