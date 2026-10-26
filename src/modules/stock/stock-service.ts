import { Prisma } from "../../generated/prisma/client";
import { ApiError, ERROR_CODES, notFoundError } from "../../lib/api-error";
import { runIdempotent, type TenantTransaction } from "../platform/idempotency";
import { findOwnedOrThrow } from "../platform/ownership";
import type { RequestContext } from "../platform/request-context";
import type { TenantClient } from "../platform/tenant-client";
import {
  encodeMovementCursor,
  MOVEMENTS_PAGE_SIZE,
  type ListMovementsQuery,
  type ReceiveBody,
} from "./stock-schema";
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

// BL16 history. Only warehouses the caller may access (ctx.warehouseIds, as for stock levels); a
// warehouseId filter outside that set simply matches nothing, so it never reveals whether the id exists.
// Keyset on (createdAt DESC, id DESC) matches the index (organization_id, created_at DESC, id DESC).
export async function listMovements(db: TenantClient, ctx: RequestContext, q: ListMovementsQuery) {
  const warehouseIds = q.warehouseId
    ? ctx.warehouseIds.filter((id) => id === q.warehouseId)
    : ctx.warehouseIds;
  const where: Prisma.StockMovementWhereInput = {
    warehouseId: { in: warehouseIds },
    ...(q.productId && { productId: q.productId }),
    ...(q.type && { type: q.type }),
    ...(q.createdById && { createdById: q.createdById }),
    ...((q.from || q.to) && {
      createdAt: { ...(q.from && { gte: q.from }), ...(q.to && { lt: q.to }) },
    }),
  };
  // Row-value comparison written as OR so Prisma can express it; Postgres still walks the index.
  const after = q.cursor
    ? {
        OR: [
          { createdAt: { lt: q.cursor.createdAt } },
          { createdAt: q.cursor.createdAt, id: { lt: q.cursor.id } },
        ],
      }
    : {};
  const rows = await db.stockMovement.findMany({
    where: { AND: [where, after] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MOVEMENTS_PAGE_SIZE + 1,
  });
  const page = rows.slice(0, MOVEMENTS_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map(movementListItem),
    nextCursor:
      rows.length > MOVEMENTS_PAGE_SIZE && last
        ? encodeMovementCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}

// P13 detail. Same visibility as the list: a movement outside ctx.warehouseIds answers 404, the same as
// a missing id or one of another organization (rule 2), so the answer never reveals that it exists.
// Names come from separate tenant-client reads (no relation select), like S06 does for its members.
export async function getMovement(db: TenantClient, ctx: RequestContext, id: string) {
  if (!UUID.test(id)) throw notFoundError();
  const row = await db.stockMovement.findFirst({ where: { id } });
  if (!row || !ctx.warehouseIds.includes(row.warehouseId)) throw notFoundError();
  const [warehouse, product, creator, transfer] = await Promise.all([
    db.warehouse.findFirst({ where: { id: row.warehouseId } }),
    db.product.findFirst({ where: { id: row.productId } }),
    db.user.findFirst({ where: { id: row.createdById } }),
    row.transferId ? db.stockTransfer.findFirst({ where: { id: row.transferId } }) : null,
  ]);
  if (!warehouse || !product) throw notFoundError();
  const transferSides = transfer
    ? await db.warehouse.findMany({
        where: { id: { in: [transfer.fromWarehouseId, transfer.toWarehouseId] } },
      })
    : [];
  const nameOf = (wid: string) => transferSides.find((w) => w.id === wid)?.name ?? null;
  return {
    ...movementListItem(row),
    warehouse: { id: warehouse.id, code: warehouse.code, name: warehouse.name },
    product: { id: product.id, sku: product.sku, name: product.name, unit: product.unit },
    // id, name and role only, never the email (as S06).
    createdBy: creator ? { id: creator.id, name: creator.name, role: creator.role } : null,
    transfer: transfer
      ? {
          id: transfer.id,
          code: transfer.code,
          fromWarehouse: { id: transfer.fromWarehouseId, name: nameOf(transfer.fromWarehouseId) },
          toWarehouse: { id: transfer.toWarehouseId, name: nameOf(transfer.toWarehouseId) },
        }
      : null,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const movementListItem = (row: Movement) => ({
  id: row.id,
  warehouseId: row.warehouseId,
  productId: row.productId,
  type: row.type,
  quantityDelta: row.quantityDelta,
  reason: row.reason,
  note: row.note,
  transferId: row.transferId,
  createdById: row.createdById,
  createdAt: row.createdAt.toISOString(),
});
