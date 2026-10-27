import { Prisma } from "../../generated/prisma/client";
import { ApiError, ERROR_CODES, notFoundError } from "../../lib/api-error";
import { runIdempotent, type TenantTransaction } from "../platform/idempotency";
import { assertOwnedIds, findOwnedOrThrow } from "../platform/ownership";
import type { RequestContext } from "../platform/request-context";
import type { TenantClient } from "../platform/tenant-client";
import type { TransferBody } from "./stock-schema";
import { addToLevel } from "./stock-service";
import { lockWarehouse } from "./warehouse-lock";

const TRANSFER_ENDPOINT = "POST /api/stock/transfers";
const SOURCE_ARCHIVED = "Gudang asal sudah diarsipkan, mutasi tidak bisa dilakukan.";
const DESTINATION_ARCHIVED = "Gudang tujuan sudah diarsipkan, mutasi tidak bisa dilakukan.";
const PRODUCT_ARCHIVED = "Produk sudah diarsipkan, mutasi tidak bisa dilakukan.";
const INSUFFICIENT = "Stok tidak cukup untuk salah satu produk.";
const TOO_BUSY = "Terlalu banyak mutasi bersamaan, coba lagi.";

// ADR 0014: the number of transfers + 1 can be picked twice by transfers on different warehouses. The
// loser hits the unique (organizationId, code), the whole transaction rolls back and the call is retried.
const MAX_CODE_RETRIES = 5;
const MAX_RETRY_PAUSE_MS = 30;

// Private: raised only by the insert of the transfer row, caught only by the retry loop.
class TransferCodeCollision extends Error {}

// Immutable data only, never stock balances (BL14): a replay must equal the first answer.
export async function loadTransfer(db: TenantClient, id: string) {
  const transfer = await db.stockTransfer.findFirst({ where: { id } });
  if (!transfer) throw notFoundError();
  const outs = await db.stockMovement.findMany({
    where: { transferId: id, type: "TRANSFER_OUT" },
    orderBy: { productId: "asc" },
  });
  return {
    id: transfer.id,
    code: transfer.code,
    fromWarehouseId: transfer.fromWarehouseId,
    toWarehouseId: transfer.toWarehouseId,
    items: outs.map((m) => ({ productId: m.productId, quantity: -m.quantityDelta })),
    note: transfer.note,
    createdAt: transfer.createdAt.toISOString(),
  };
}
export type TransferResponse = Awaited<ReturnType<typeof loadTransfer>>;

// BL13. The caller (route handler) has already called authorize(stock.transfer) for the SOURCE warehouse
// (ADR 0012). The lookups turn a foreign or missing warehouse or product into 404 (rule 2); the tenant
// client does not check foreign keys. includeArchived: the archived check belongs inside the transaction.
export async function transferStock(
  db: TenantClient,
  ctx: RequestContext,
  key: string,
  body: TransferBody,
) {
  await findOwnedOrThrow(db, "warehouse", body.fromWarehouseId, { includeArchived: true });
  await findOwnedOrThrow(db, "warehouse", body.toWarehouseId, { includeArchived: true });
  await assertOwnedIds(
    db,
    "product",
    body.items.map((item) => item.productId),
    { includeArchived: true },
  );
  for (let retry = 0; ; retry++) {
    try {
      return await runIdempotent(
        db,
        { key, endpoint: TRANSFER_ENDPOINT },
        {
          work: (tx) => transferInTransaction(tx, ctx, body),
          load: loadTransfer,
          access: { ctx, action: "stock.transfer", warehouseIdOf: (row) => row.fromWarehouseId },
        },
      );
    } catch (error) {
      // Any other error, and a clash of the idempotency key (replayed by runIdempotent), is not retried.
      if (!(error instanceof TransferCodeCollision)) throw error;
      if (retry >= MAX_CODE_RETRIES) throw new ApiError(409, ERROR_CODES.CONFLICT, TOO_BUSY);
      await pause();
    }
  }
}

const pause = () =>
  new Promise((resolve) => setTimeout(resolve, Math.random() * MAX_RETRY_PAUSE_MS));

// Order matters (ADR 0013, 0014): lock both warehouses in ascending id order, only then read archivedAt
// and the stock. With both locks held no other stock write touches either warehouse, so the statement
// order below cannot deadlock; it is still deterministic (items by productId).
async function transferInTransaction(
  tx: TenantTransaction,
  ctx: RequestContext,
  body: TransferBody,
): Promise<string> {
  const { fromWarehouseId, toWarehouseId } = body;
  const items = [...body.items].sort((a, b) => a.productId.localeCompare(b.productId));

  const warehouses = await lockBoth(tx, fromWarehouseId, toWarehouseId);
  if (warehouses.get(fromWarehouseId)?.archivedAt) {
    throw new ApiError(409, ERROR_CODES.CONFLICT, SOURCE_ARCHIVED);
  }
  if (warehouses.get(toWarehouseId)?.archivedAt) {
    throw new ApiError(409, ERROR_CODES.CONFLICT, DESTINATION_ARCHIVED);
  }
  await assertProductsActive(tx, items);

  await decrementSource(tx, fromWarehouseId, items);
  await incrementDestination(tx, ctx.organizationId, toWarehouseId, items);

  const transfer = await createTransfer(tx, ctx, body);
  // One statement for every movement: the two locks are held until commit, so fewer round trips.
  await tx.stockMovement.createMany({
    data: items.flatMap(({ productId, quantity }) => [
      movement(ctx, transfer.id, fromWarehouseId, productId, -quantity, "TRANSFER_OUT"),
      movement(ctx, transfer.id, toWarehouseId, productId, quantity, "TRANSFER_IN"),
    ]),
  });
  return transfer.id;
}

// Ascending id order is what keeps two opposite transfers (A to B, B to A) from deadlocking.
async function lockBoth(tx: TenantTransaction, one: string, other: string) {
  const rows = new Map<string, Awaited<ReturnType<typeof lockWarehouse>>>();
  for (const id of [one, other].sort()) rows.set(id, await lockWarehouse(tx, id));
  return rows;
}

async function assertProductsActive(tx: TenantTransaction, items: TransferBody["items"]) {
  const products = await tx.product.findMany({
    where: { id: { in: items.map((item) => item.productId) } },
  });
  if (products.length !== items.length) throw notFoundError();
  if (products.some((product) => product.archivedAt)) {
    throw new ApiError(409, ERROR_CODES.CONFLICT, PRODUCT_ARCHIVED);
  }
}

// Conditional atomic update (rule 6): it only applies while quantity >= the amount, so the stock cannot
// go below 0 even if a writer outside this lock existed. count 0 means a missing row or too little stock.
async function decrementSource(
  tx: TenantTransaction,
  warehouseId: string,
  items: TransferBody["items"],
) {
  for (const { productId, quantity } of items) {
    const updated = await tx.stockLevel.updateMany({
      where: { warehouseId, productId, quantity: { gte: quantity } },
      data: { quantity: { decrement: quantity } },
    });
    if (updated.count === 0) {
      throw new ApiError(409, ERROR_CODES.INSUFFICIENT_STOCK, INSUFFICIENT, { productId });
    }
  }
}

// One INSERT ... ON CONFLICT DO NOTHING for the missing rows, then an atomic increment per item.
// addToLevel turns a 32-bit overflow (Postgres 22003) into a 409, as receive does.
async function incrementDestination(
  tx: TenantTransaction,
  organizationId: string,
  warehouseId: string,
  items: TransferBody["items"],
) {
  await tx.stockLevel.createMany({
    data: items.map(({ productId }) => ({ organizationId, warehouseId, productId, quantity: 0 })),
    skipDuplicates: true,
  });
  for (const { productId, quantity } of items) {
    await addToLevel(tx, warehouseId, productId, quantity);
  }
}

// MT-0001, sequential per organization, without raw SQL or a counter row (ADR 0014). The tenant client
// scopes the count to the organization. A rolled back transaction consumes no number.
async function createTransfer(tx: TenantTransaction, ctx: RequestContext, body: TransferBody) {
  const count = await tx.stockTransfer.count();
  try {
    return await tx.stockTransfer.create({
      data: {
        organizationId: ctx.organizationId,
        code: `MT-${String(count + 1).padStart(4, "0")}`,
        fromWarehouseId: body.fromWarehouseId,
        toWarehouseId: body.toWarehouseId,
        note: body.note ?? null,
        createdById: ctx.userId,
      },
    });
  } catch (error) {
    // The only unique constraint this insert can break is (organizationId, code).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new TransferCodeCollision();
    }
    throw error;
  }
}

function movement(
  ctx: RequestContext,
  transferId: string,
  warehouseId: string,
  productId: string,
  quantityDelta: number,
  type: "TRANSFER_OUT" | "TRANSFER_IN",
) {
  return {
    organizationId: ctx.organizationId,
    warehouseId,
    productId,
    quantityDelta,
    type,
    transferId,
    createdById: ctx.userId,
  };
}
