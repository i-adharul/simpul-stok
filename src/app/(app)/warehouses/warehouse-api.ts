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

// S06. Under the list key, so every write that invalidates the list refreshes the detail too.
export type AssignedUser = { id: string; name: string; role: "WAREHOUSE_ADMIN" | "VIEWER" };
export type WarehouseDetail = Warehouse & { assignedUsers: AssignedUser[] };
export const ROLE_LABEL: Record<AssignedUser["role"], string> = {
  WAREHOUSE_ADMIN: "Admin Gudang",
  VIEWER: "Viewer",
};
export const warehouseKey = (id: string) => [...WAREHOUSES_QUERY_KEY, "detail", id] as const;

export function fetchWarehouse(id: string): Promise<WarehouseDetail> {
  return apiFetch<WarehouseDetail>(`/api/warehouses/${id}`);
}
export const PAGE_SIZE = 20;

export function fetchWarehouses(page: number, includeArchived = false): Promise<WarehousePage> {
  const archived = includeArchived ? "&includeArchived=true" : "";
  return apiFetch<WarehousePage>(`/api/warehouses?page=${page}&pageSize=${PAGE_SIZE}${archived}`);
}

// P03. The server refuses to archive a warehouse that still holds stock (409).
export function setWarehouseArchived(id: string, archived: boolean): Promise<Warehouse> {
  return apiFetch<Warehouse>(`/api/warehouses/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ archived }),
  });
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

// P06 (docs/04_API_Spec.md, "Warehouse assignment"). Owner only.
export type MemberCandidate = {
  id: string;
  name: string;
  email: string;
  role: "WAREHOUSE_ADMIN" | "VIEWER";
  assigned: boolean;
};
export type MemberCandidates = { candidates: MemberCandidate[] };

export const warehouseMembersKey = (id: string) => ["warehouse-members", id] as const;

export function fetchWarehouseMembers(id: string): Promise<MemberCandidates> {
  return apiFetch<MemberCandidates>(`/api/warehouses/${id}/members`);
}

// Replaces the whole set of assigned users.
export function saveWarehouseMembers(id: string, userIds: string[]): Promise<MemberCandidates> {
  return apiFetch<MemberCandidates>(`/api/warehouses/${id}/members`, {
    method: "PUT",
    body: JSON.stringify({ userIds }),
  });
}
