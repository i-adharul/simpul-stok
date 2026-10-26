import type { Product, StockTransfer, User, Warehouse } from "../../generated/prisma/client";
import { notFoundError } from "../../lib/api-error";
import type { TenantClient } from "./tenant-client";

// Ownership helpers (CLAUDE.md rule 2, BL03, ADR 0011). They take the TenantClient only, so a row
// of another organization is already invisible: "not yours" and "does not exist" are the same
// answer, and the same 404 body.

type RowOf = { warehouse: Warehouse; product: Product; stockTransfer: StockTransfer; user: User };
export type OwnedModel = keyof RowOf;
// Only these two have archivedAt. Archived rows are hidden unless the caller opts in.
const ARCHIVABLE = new Set<OwnedModel>(["warehouse", "product"]);

export type OwnershipOptions = { includeArchived?: boolean };

type Delegate = {
  findFirst(args: { where: Record<string, unknown> }): Promise<unknown>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function whereFor(model: OwnedModel, ids: string[], options: OwnershipOptions) {
  const where: Record<string, unknown> = { id: ids.length === 1 ? ids[0] : { in: ids } };
  if (ARCHIVABLE.has(model) && !options.includeArchived) where.archivedAt = null;
  return where;
}

// Loads a row of the session's organization by an ID from the URL or body.
export async function findOwnedOrThrow<M extends OwnedModel>(
  db: TenantClient,
  model: M,
  id: string,
  options: OwnershipOptions = {},
): Promise<RowOf[M]> {
  // A malformed ID cannot exist; answering 404 also avoids a database error that reads as a 500.
  if (!UUID.test(id)) throw notFoundError();
  const delegate = db[model] as unknown as Delegate;
  const row = await delegate.findFirst({ where: whereFor(model, [id], options) });
  if (!row) throw notFoundError();
  return row as RowOf[M];
}

// The tenant client does not verify foreign key IDs in a write. A service calls this with every
// ID taken from the request body (warehouseId, productId, destination warehouse) before writing.
export async function assertOwnedIds(
  db: TenantClient,
  model: OwnedModel,
  ids: string[],
  options: OwnershipOptions = {},
): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  if (!unique.every((id) => UUID.test(id))) throw notFoundError();
  const delegate = db[model] as unknown as Delegate;
  const found = await delegate.count({ where: whereFor(model, unique, options) });
  if (found !== unique.length) throw notFoundError();
}
