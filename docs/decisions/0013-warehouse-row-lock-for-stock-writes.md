# ADR 0013: Warehouse row lock as the serialization point for stock writes

- Status: accepted
- Date: 2026-10-26

## Context

A stock write (receive now; adjust, transfer and import commit later) must not interleave with archiving the
warehouse: BL08 says an archived warehouse holds no stock. Archiving checks "no stock above 0" and then writes
`archivedAt`; a receipt that commits between the two leaves an archived warehouse with stock. The receipt, for its
part, must read `archivedAt` and the stock only after nothing else can change them. Raw SQL is banned for tenant
code (rule 3, lint), and a first receipt of a (warehouse, product) pair may run twice at once, so the
`StockLevel` row must be created and increased without losing an update.

## Decision

- `lockWarehouse(tx, warehouseId)` in `modules/stock/warehouse-lock.ts` updates the warehouse row
  (`updatedAt = now`). That takes a row lock until the transaction ends (Postgres `FOR NO KEY UPDATE`, which conflicts with every
  other UPDATE of the row, see "Row-Level Locks" in the PostgreSQL manual), with no raw SQL. It does not block
  a plain foreign-key check of another insert, so the rule only holds because every stock write takes it. It returns
  the row as it is after the lock was granted.
- A stock write order is: lock the warehouse, read `archivedAt` of the warehouse and the product, then change the
  stock and write the movement, all in one `$transaction` (also the one of `runIdempotent`, ADR 0012).
- Archiving a warehouse runs in a `$transaction` too: lock, then `quantity > 0` check, then write `archivedAt`.
  Whoever takes the lock first wins; the other sees the result (receipt: 409 for an archived warehouse; archive:
  409 for a warehouse with stock).
- The `StockLevel` row is created with `createMany({ skipDuplicates: true })` (`INSERT ... ON CONFLICT DO
NOTHING`) and changed with an atomic `increment`, so two first receipts neither collide nor lose an update.
- A receipt that would pass the 32-bit column maximum raises Postgres 22003 (Prisma P2020); the service maps only
  that to a 409 with an Indonesian message.
- Later stock writes use the same helper. A write that touches two warehouses (transfer, E5) locks them one after
  the other in ascending id order, so two opposite transfers cannot deadlock.

## Alternatives considered

- **`SELECT ... FOR UPDATE` or an advisory lock through raw SQL.** Stronger wording of the same idea, but raw
  SQL is forbidden by lint outside an allowlist and would need its own exception entry. Rejected for this story.
- **`SERIALIZABLE` isolation.** Correct without a lock, but it fails with serialization errors that every caller
  must retry, and it affects every query of the transaction. Rejected.
- **Only the atomic increment, no lock.** Safe for the quantity, but it does not stop a receipt from landing in a
  warehouse that is being archived at the same moment. Rejected.

## Consequences

- Stock writes into one warehouse run one after another; different warehouses stay parallel. At the expected scale
  this is acceptable; waiting writers rely on the 10 s transaction limits of `runIdempotent`.
- The `updatedAt` of a warehouse changes on every stock write and on every archive attempt. It no longer means
  "the warehouse data was edited".
- A tenant request that finds the warehouse already archived at request start gets 403 from `authorize()`
  (`ctx.warehouseIds` has no archived warehouse); 409 appears only for the race.
- Concurrency tests need a database pool of at least the number of parallel transactions
  (`createTestPrisma(url, { max })`).
- A static test (`modules/stock/stock-write-lock.test.ts`) fails CI when a non-test file in `modules/stock/` writes
  `StockLevel` or `StockMovement` without calling `lockWarehouse(`, so adjust, transfer and import cannot forget
  the lock. A real exception is listed with a reason in `modules/stock/lock-exemptions.ts` (empty at the start).
  The test reads source text, so a lock taken in a helper file needs that file listed or the call kept next to the
  write.
