import { apiFetch } from "@/lib/api-client";
import type { WarehouseFormValues } from "./warehouse-form-schema";

// Shape of the warehouse API (docs/04_API_Spec.md). Declared here because the server type pulls in Prisma.
export type Warehouse = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  archivedAt: string | null;
};
export type WarehousePage = { items: Warehouse[]; total: number; page: number; pageSize: number };

export const WAREHOUSES_QUERY_KEY = ["warehouses"] as const;
export const PAGE_SIZE = 20;

export function fetchWarehouses(page: number): Promise<WarehousePage> {
  return apiFetch<WarehousePage>(`/api/warehouses?page=${page}&pageSize=${PAGE_SIZE}`);
}

// An empty address is sent as null so the API stores it as null (so an edit can clear it).
function toBody(values: WarehouseFormValues) {
  return { code: values.code, name: values.name, address: values.address || null };
}

export function saveWarehouse(id: string | null, values: WarehouseFormValues): Promise<Warehouse> {
  return apiFetch<Warehouse>(id ? `/api/warehouses/${id}` : "/api/warehouses", {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(toBody(values)),
  });
}
