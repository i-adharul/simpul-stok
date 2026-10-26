import { ApiError, ERROR_CODES, notFoundError } from "../../lib/api-error";
import { runIdempotent, type TenantTransaction } from "../platform/idempotency";
import { findOwnedOrThrow } from "../platform/ownership";
import type { RequestContext } from "../platform/request-context";
import type { TenantClient } from "../platform/tenant-client";
import { MAX_ADJUST_QUANTITY, type AdjustBody } from "./stock-schema";
import { loadMovement, movementBody } from "./stock-service";
import { lockWarehouse } from "./warehouse-lock";

const ADJUST_ENDPOINT = "POST /api/stock/adjust";
const WAREHOUSE_ARCHIVED = "Gudang sudah diarsipkan, stok tidak bisa disesuaikan.";
const NO_DIFFERENCE = "Stok baru sama dengan stok saat ini, tidak ada yang disesuaikan.";
const BELOW_ZERO = "Stok tidak boleh menjadi kurang dari 0.";
const TOO_LARGE = "Stok tidak boleh melebihi 1.000.000.";
const CHANGED = "Stok berubah saat disesuaikan. Coba lagi.";

// Immutable data of the movement only (never the current stock), so a replay equals the first answer.
export const adjustmentBody = (row: Awaited<ReturnType<typeof loadMovement>>) => ({
  ...movementBody(row),
  reason: row.reason,
});

// BL12, BL15, BL09. The caller has already called authorize() (ADR 0012). An ARCHIVED product may be
// adjusted (so leftover stock can be zeroed); an archived warehouse may not.
export async function adjustStock(
  db: TenantClient,
  ctx: RequestContext,
  key: string,
  body: AdjustBody,
) {
  await findOwnedOrThrow(db, "warehouse", body.warehouseId, { includeArchived: true });
  await findOwnedOrThrow(db, "product", body.productId, { includeArchived: true });
  return runIdempotent(
    db,
    { key, endpoint: ADJUST_ENDPOINT },
    {
      work: (tx) => adjustInTransaction(tx, ctx, body),
      load: loadMovement,
      access: { ctx, action: "stock.adjust", warehouseIdOf: (row) => row.warehouseId },
    },
  );
}

// Pure rule: the delta and the final quantity for the requested mode, or the error to answer.
export function planAdjustment(current: number, body: AdjustBody): { next: number; delta: number } {
  const next = body.mode === "SET" ? body.value : current + body.value;
  const delta = next - current;
  if (delta === 0) throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, NO_DIFFERENCE);
  if (next < 0) throw new ApiError(409, ERROR_CODES.CONFLICT, BELOW_ZERO);
  if (next > MAX_ADJUST_QUANTITY || Math.abs(delta) > MAX_ADJUST_QUANTITY) {
    throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, TOO_LARGE);
  }
  return { next, delta };
}

// Order matters: lock the warehouse first, then read the quantity, so the delta is computed from
// the value no one else can change before commit.
async function adjustInTransaction(
  tx: TenantTransaction,
  ctx: RequestContext,
  body: AdjustBody,
): Promise<string> {
  const { warehouseId, productId, reason, note } = body;
  const warehouse = await lockWarehouse(tx, warehouseId);
  if (warehouse.archivedAt) throw new ApiError(409, ERROR_CODES.CONFLICT, WAREHOUSE_ARCHIVED);
  const product = await tx.product.findFirst({ where: { id: productId } });
  if (!product) throw notFoundError();

  const level = await tx.stockLevel.findFirst({ where: { warehouseId, productId } });
  const { next, delta } = planAdjustment(level?.quantity ?? 0, body);
  const organizationId = ctx.organizationId;
  if (!level) {
    await tx.stockLevel.createMany({
      data: [{ organizationId, warehouseId, productId, quantity: 0 }],
      skipDuplicates: true,
    });
  }
  // Conditional atomic update: only applies if the quantity is still what the delta was computed from.
  const updated = await tx.stockLevel.updateMany({
    where: { warehouseId, productId, quantity: level?.quantity ?? 0 },
    data: { quantity: next },
  });
  if (updated.count !== 1) throw new ApiError(409, ERROR_CODES.CONFLICT, CHANGED);
  const movement = await tx.stockMovement.create({
    data: {
      organizationId,
      warehouseId,
      productId,
      quantityDelta: delta,
      type: "ADJUST",
      reason,
      note: note ?? null,
      createdById: ctx.userId,
    },
  });
  return movement.id;
}
