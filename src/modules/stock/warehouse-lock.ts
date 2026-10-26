import type { TenantTransaction } from "../platform/idempotency";

// The serialization point for stock writes and for archiving a warehouse (ADR 0013). It is an UPDATE
// of the warehouse row, which takes a row lock until the transaction ends (Postgres FOR NO KEY UPDATE: it blocks every other
// UPDATE of the row, and so every other holder of this lock), without raw SQL
// (rule 3). Whoever holds it is the only one writing stock of this warehouse or archiving it; the rest
// wait. Side effect: the warehouse's updatedAt changes on every call.
//
// Returns the row as it is AFTER the lock was granted, so `archivedAt` is the committed value of the
// transaction that held the lock before. A missing or foreign id throws the usual 404.
export function lockWarehouse(tx: TenantTransaction, warehouseId: string) {
  return tx.warehouse.update({ where: { id: warehouseId }, data: { updatedAt: new Date() } });
}
