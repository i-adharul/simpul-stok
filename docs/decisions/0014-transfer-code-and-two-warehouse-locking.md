# ADR 0014: Transfer code without a shared row, and two-warehouse locking for transfers

- Status: accepted
- Date: 2026-10-27

## Context

A transfer gets a code `MT-0001`, sequential per organization (functional spec, Design decisions: Document
numbers). The spec forbids a design where all transfers of an organization queue on one row. A transfer also
writes stock in two warehouses at once, so it must not deadlock with an opposite transfer (BL13), and raw SQL is
banned for tenant code (rule 3). No migration is wanted for this story.

## Decision

- **Locking.** `transferStock` runs inside `runIdempotent` (ADR 0012) and takes `lockWarehouse` (ADR 0013) for
  both warehouses in ascending id order, before it reads `archivedAt`, the products or any stock. Two transfers
  that share a warehouse therefore wait for each other in the same order and cannot deadlock, whatever the
  direction. While both locks are held no other stock write touches either warehouse, so the order of the stock
  statements inside the transaction cannot cause a deadlock either. It is still deterministic: items sorted by
  `productId`, all source decrements first (so a shortage fails before the destination is touched), then the
  destination rows and increments. The rule "ordered by (warehouseId, productId)" is met by the lock order plus
  this item order.
- **Code.** Inside the transaction: `count` of the organization's transfers plus one, padded to four digits.
  Transfers are never deleted (rule 8) and a rolled back transaction consumes nothing, so codes have no gaps.
- **Collision.** Two transfers on different warehouses can read the same count. The second insert waits on the
  unique index `(organizationId, code)` and fails with P2002 when the first commits. Only the insert of the
  transfer row is wrapped: its P2002 becomes a private `TransferCodeCollision`, and only that class makes the
  caller repeat the whole `runIdempotent` call, up to 5 times with a random pause of at most 30 ms. A clash of the
  idempotency key is a different P2002 that `runIdempotent` already turns into a replay; it is not retried. After
  the retries are used up the answer is `409 CONFLICT` ("Terlalu banyak mutasi bersamaan, coba lagi."), never a 500.
- **Movements.** All movements of a transfer are written with one `createMany` (two rows per item, same
  `transferId`), and the destination rows with one `createMany` (`skipDuplicates`), to keep the time the two
  locks are held short.
- The response is built from the stored rows (id, code, warehouses, items, note, createdAt), never from stock
  balances, so a replay equals the first answer.

## Alternatives considered

- **A counter table (one row per organization, incremented per transfer).** Gap-free and simple, but it needs a
  migration and every transfer of an organization would queue on that row, which the spec forbids. Rejected.
- **A Postgres advisory lock per organization.** Same serialization, and it needs raw SQL, which lint forbids
  outside an allowlist. Rejected.
- **Locking a fixed row (for example the organization) while numbering.** Serializes unrelated work, including
  transfers between different warehouses. Rejected.
- **A database sequence or random code.** A sequence is global and leaves gaps after a rollback; a random code
  is not sequential. Rejected.
- **Matching the P2002 constraint name instead of wrapping the insert.** The error meta differs per driver
  adapter, and a wrong match would retry a key clash. The narrow wrapper around the one insert is unambiguous.
  Rejected.

## Consequences

- Transfers on one warehouse run one after another, as every stock write already does (ADR 0013). Transfers on
  disjoint warehouses stay parallel but may rarely retry on a code collision; a busy organization can see the 409
  above when five retries in a row collide.
- The code depends on transfers never being deleted. Deleting one would reuse its number.
- The retry path is tested without a hook in production code: a test inserts one transfer coded `MT-0002`, so the
  count is 1 and the next code `MT-0002` collides on every attempt, until the 409 above is returned with nothing
  changed.
- A transfer locks two warehouses, so it holds both until commit; the 10 s limits of `runIdempotent` apply and a
  50 item transfer is tested to finish inside them.
