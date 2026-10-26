import { Prisma } from "../../generated/prisma/client";
import { ApiError, ERROR_CODES, notFoundError } from "../../lib/api-error";
import { runIdempotent, type TenantTransaction } from "../platform/idempotency";
import { findOwnedOrThrow } from "../platform/ownership";
import type { RequestContext } from "../platform/request-context";
import type { TenantClient } from "../platform/tenant-client";
import type { ReceiveBody } from "./stock-schema";
import { lockWarehouse } from "./warehouse-lock";

const RECEIVE_ENDPOINT = "POST /api/stock/receive";
const WAREHOUSE_ARCHIVED = "Gudang sudah diarsipkan, stok tidak bisa diterima.";
const QUANTITY_OVERFLOW = "Jumlah stok akan melebihi batas yang bisa disimpan.";
const PRODUCT_ARCHIVED = "Produk sudah diarsipkan, stok tidak bisa diterima.";

export async function loadMovement(db: TenantClient, id: string) {
  const row = await db.stockMovement.findFirst({ where: { id } });
  if (!row) throw notFoundError();
  return row;
}
type Movement = Awaited<ReturnType<typeof loadMovement>>;

// Only immutable data of the movement, never the current stock: a replay must equal the first answer.
export const movementBody = (row: Movement) => ({
  id: row.id,
  warehouseId: row.warehouseId,
  productId: row.productId,
  quantity: row.quantityDelta,
  createdAt: row.createdAt.toISOString(),
});

// BL11. The caller (route handler) has already called authorize() (ADR 0012). The lookups below turn
// a product of another organization into 404 (rule 2); the tenant client does not check foreign keys.
// includeArchived: the archived check belongs inside the transaction, after the lock (ADR 0013).
export async function receiveStock(
  db: TenantClient,
  ctx: RequestContext,
  key: string,
  body: ReceiveBody,
) {
  await findOwnedOrThrow(db, "warehouse", body.warehouseId, { includeArchived: true });
  await findOwnedOrThrow(db, "product", body.productId, { includeArchived: true });
  return runIdempotent(
    db,
    { key, endpoint: RECEIVE_ENDPOINT },
    {
      work: (tx) => receiveInTransaction(tx, ctx, body),
      load: loadMovement,
      access: { ctx, action: "stock.receive", warehouseIdOf: (row) => row.warehouseId },
    },
  );
}

// Order matters: lock the warehouse, only then read archivedAt and the stock, so archiving and
// receiving cannot interleave (BL08). Returns the movement id for runIdempotent.
async function receiveInTransaction(
  tx: TenantTransaction,
  ctx: RequestContext,
  body: ReceiveBody,
): Promise<string> {
  const { warehouseId, productId, quantity, note } = body;
  const warehouse = await lockWarehouse(tx, warehouseId);
  if (warehouse.archivedAt) throw new ApiError(409, ERROR_CODES.CONFLICT, WAREHOUSE_ARCHIVED);
  const product = await tx.product.findFirst({ where: { id: productId } });
  if (!product) throw notFoundError();
  if (product.archivedAt) throw new ApiError(409, ERROR_CODES.CONFLICT, PRODUCT_ARCHIVED);

  // INSERT ... ON CONFLICT DO NOTHING, then an atomic increment: two first receipts of one pair
  // cannot both insert, and neither loses its update.
  const organizationId = ctx.organizationId;
  await tx.stockLevel.createMany({
    data: [{ organizationId, warehouseId, productId, quantity: 0 }],
    skipDuplicates: true,
  });
  await addToLevel(tx, warehouseId, productId, quantity);
  const movement = await tx.stockMovement.create({
    data: {
      organizationId,
      warehouseId,
      productId,
      quantityDelta: quantity,
      type: "RECEIVE",
      note: note ?? null,
      createdById: ctx.userId,
    },
  });
  return movement.id;
}

// StockLevel.quantity is a 32-bit INTEGER. An increment past its maximum makes Postgres raise 22003,
// which Prisma reports as P2020 (verified in stock-receive.test.ts). Only that case becomes a 409;
// every other error is passed on unchanged.
async function addToLevel(
  tx: TenantTransaction,
  warehouseId: string,
  productId: string,
  quantity: number,
): Promise<void> {
  try {
    await tx.stockLevel.update({
      where: { warehouseId_productId: { warehouseId, productId } },
      data: { quantity: { increment: quantity } },
    });
  } catch (error) {
    if (isOutOfRange(error)) throw new ApiError(409, ERROR_CODES.CONFLICT, QUANTITY_OVERFLOW);
    throw error;
  }
}

function isOutOfRange(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2020") {
    return false;
  }
  const meta = error.meta as { driverAdapterError?: { cause?: { originalCode?: string } } };
  return meta?.driverAdapterError?.cause?.originalCode === "22003";
}
