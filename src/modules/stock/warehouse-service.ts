import { ApiError, ERROR_CODES } from "../../lib/api-error";
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
const HAS_STOCK = "Gudang masih memiliki stok. Kosongkan stok sebelum mengarsipkan.";

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

// 404 first (other organization or missing look the same), then 403 for a warehouse of this
// organization that the user is not assigned to. An archived warehouse is visible to the Owner only,
// so it can be restored; ctx.warehouseIds never holds it, hence the Owner skips the per-warehouse check.
export async function getWarehouse(db: TenantClient, ctx: RequestContext, id: string) {
  const isOwner = ctx.role === "OWNER";
  const warehouse = await findOwnedOrThrow(db, "warehouse", id, { includeArchived: isOwner });
  authorize(ctx, "warehouse.read", isOwner ? {} : { warehouseId: warehouse.id });
  return { ...warehouse, assignedUsers: await readAssignedUsers(db, warehouse.id) };
}

// S06: id, name and role only (no email). Two tenant-client reads instead of a relation select, the
// same way the P06 candidates are read. Inactive users are left out: they cannot act on the warehouse.
async function readAssignedUsers(db: TenantClient, warehouseId: string) {
  const rows = await db.userWarehouse.findMany({
    where: { warehouseId },
    select: { userId: true },
  });
  if (rows.length === 0) return [];
  return db.user.findMany({
    where: { id: { in: rows.map((row) => row.userId) }, isActive: true },
    select: { id: true, name: true, role: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
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

// BL08: archive only when every stock row is 0. Restoring needs the archived row, so it is looked up
// through the tenant client with includeArchived (never from ctx.warehouseIds). The plan-limit check
// on restore (P03) arrives with E8.
export async function updateWarehouse(db: TenantClient, id: string, body: UpdateWarehouseBody) {
  const { archived, ...fields } = body;
  await findOwnedOrThrow(db, "warehouse", id, { includeArchived: archived === false });
  if (archived === true) await assertNoStock(db, id);
  const data =
    archived === undefined ? fields : { ...fields, archivedAt: archived ? new Date() : null };
  return conflictOnUnique(() => db.warehouse.update({ where: { id }, data }), DUPLICATE_CODE);
}

async function assertNoStock(db: TenantClient, warehouseId: string) {
  const withStock = await db.stockLevel.count({ where: { warehouseId, quantity: { gt: 0 } } });
  if (withStock > 0) throw new ApiError(409, ERROR_CODES.CONFLICT, HAS_STOCK);
}
