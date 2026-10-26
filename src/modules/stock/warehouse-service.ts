import { conflictOnUnique } from "../../lib/unique-violation";
import { authorize } from "../platform/can";
import { findOwnedOrThrow } from "../platform/ownership";
import type { RequestContext } from "../platform/request-context";
import type { TenantClient } from "../platform/tenant-client";
import type {
  CreateWarehouseBody,
  ListWarehousesQuery,
  UpdateWarehouseBody,
} from "./warehouse-schema";

const DUPLICATE_CODE = "Kode gudang sudah dipakai.";

// BL08 list. Owner: every active warehouse (archived ones only on request, so E3-03 can restore).
// Warehouse Admin and Viewer: only the assigned ones; ctx.warehouseIds never holds an archived one.
export async function listWarehouses(
  db: TenantClient,
  ctx: RequestContext,
  q: ListWarehousesQuery,
) {
  const where =
    ctx.role === "OWNER"
      ? q.includeArchived
        ? {}
        : { archivedAt: null }
      : { id: { in: ctx.warehouseIds } };
  const [items, total] = await Promise.all([
    db.warehouse.findMany({
      where,
      orderBy: [{ code: "asc" }, { id: "asc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.warehouse.count({ where }),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize };
}

// 404 first (other organization, missing or archived look the same), then 403 for a warehouse of
// this organization that the user is not assigned to.
export async function getWarehouse(db: TenantClient, ctx: RequestContext, id: string) {
  const warehouse = await findOwnedOrThrow(db, "warehouse", id);
  authorize(ctx, "warehouse.read", { warehouseId: warehouse.id });
  return warehouse;
}

// Plan limit is not enforced yet (E8).
export function createWarehouse(db: TenantClient, ctx: RequestContext, body: CreateWarehouseBody) {
  // The type requires organizationId; the tenant client accepts only the session's own value.
  return conflictOnUnique(
    () =>
      db.warehouse.create({
        data: {
          organizationId: ctx.organizationId,
          code: body.code,
          name: body.name,
          address: body.address ?? null,
        },
      }),
    DUPLICATE_CODE,
  );
}

export async function updateWarehouse(db: TenantClient, id: string, body: UpdateWarehouseBody) {
  await findOwnedOrThrow(db, "warehouse", id);
  return conflictOnUnique(() => db.warehouse.update({ where: { id }, data: body }), DUPLICATE_CODE);
}
