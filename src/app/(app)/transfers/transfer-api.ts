import { apiFetch } from "@/lib/api-client";
import { STOCK_QUERY_KEY } from "../stock/stock-api";

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
