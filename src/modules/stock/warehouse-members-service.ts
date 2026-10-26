import { ApiError, ERROR_CODES } from "../../lib/api-error";
import { assertOwnedIds, findOwnedOrThrow } from "../platform/ownership";
import type { TenantClient } from "../platform/tenant-client";

// BL10: only these roles can be assigned. The Owner reaches every active warehouse without rows.
const ASSIGNABLE_ROLES = ["WAREHOUSE_ADMIN", "VIEWER"] as const;
const NOT_ASSIGNABLE = "Pengguna yang dipilih tidak dapat ditugaskan ke gudang.";

// The users that can be assigned, each flagged with whether this warehouse already has them.
// An archived warehouse is a 404: assignments are not edited on it.
export async function listWarehouseMembers(db: TenantClient, warehouseId: string) {
  await findOwnedOrThrow(db, "warehouse", warehouseId);
  return readCandidates(db, warehouseId);
}

// Replaces the whole set (idempotent). Foreign IDs are looked up through the tenant client first,
// because the client does not check foreign keys in a write (ADR 0011): another organization's user
// ID gets the same 404 as a missing one. One transaction, so a reader never sees a half-replaced set.
export async function replaceWarehouseMembers(
  db: TenantClient,
  organizationId: string,
  warehouseId: string,
  userIds: string[],
) {
  await findOwnedOrThrow(db, "warehouse", warehouseId);
  await assertOwnedIds(db, "user", userIds);
  await assertAssignable(db, userIds);
  await db.$transaction(async (tx) => {
    await tx.userWarehouse.deleteMany({ where: { warehouseId } });
    if (userIds.length > 0) {
      await tx.userWarehouse.createMany({
        data: userIds.map((userId) => ({ organizationId, warehouseId, userId })),
      });
    }
  });
  return readCandidates(db, warehouseId);
}

// A generic message: it must not say which rule (inactive, Owner) a given ID broke.
async function assertAssignable(db: TenantClient, userIds: string[]) {
  if (userIds.length === 0) return;
  const ok = await db.user.count({
    where: { id: { in: userIds }, isActive: true, role: { in: [...ASSIGNABLE_ROLES] } },
  });
  if (ok !== userIds.length) throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, NOT_ASSIGNABLE);
}

async function readCandidates(db: TenantClient, warehouseId: string) {
  const [users, assigned] = await Promise.all([
    db.user.findMany({
      where: { isActive: true, role: { in: [...ASSIGNABLE_ROLES] } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    db.userWarehouse.findMany({ where: { warehouseId }, select: { userId: true } }),
  ]);
  const assignedIds = new Set(assigned.map((row) => row.userId));
  return { candidates: users.map((user) => ({ ...user, assigned: assignedIds.has(user.id) })) };
}
