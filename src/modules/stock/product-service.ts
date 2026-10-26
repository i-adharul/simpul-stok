import { conflictOnUnique } from "../../lib/unique-violation";
import { findOwnedOrThrow } from "../platform/ownership";
import type { RequestContext } from "../platform/request-context";
import type { TenantClient } from "../platform/tenant-client";
import type { CreateProductBody, ListProductsQuery, UpdateProductBody } from "./product-schema";

const DUPLICATE_SKU = "SKU sudah dipakai.";

// BL09 list. Every tenant role reads products; archived ones are shown to the Owner only, on request,
// so they can be restored.
export async function listProducts(db: TenantClient, ctx: RequestContext, q: ListProductsQuery) {
  const where = ctx.role === "OWNER" && q.includeArchived ? {} : { archivedAt: null };
  const [items, total] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: [{ sku: "asc" }, { id: "asc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.product.count({ where }),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize };
}

// Other organization, missing and malformed ids are all 404. Archived is visible to the Owner only.
export function getProduct(db: TenantClient, ctx: RequestContext, id: string) {
  return findOwnedOrThrow(db, "product", id, { includeArchived: ctx.role === "OWNER" });
}

// Plan limit is not enforced yet (E8).
export function createProduct(db: TenantClient, ctx: RequestContext, body: CreateProductBody) {
  // The type requires organizationId; the tenant client accepts only the session's own value.
  return conflictOnUnique(
    () => db.product.create({ data: { organizationId: ctx.organizationId, ...body } }),
    DUPLICATE_SKU,
  );
}

// Restoring needs the archived row, so it is looked up with includeArchived. Archiving a product with
// stock is allowed (BL09: it can still be adjusted to zero). The plan-limit check on restore comes with E8.
export async function updateProduct(db: TenantClient, id: string, body: UpdateProductBody) {
  const { archived, ...fields } = body;
  await findOwnedOrThrow(db, "product", id, { includeArchived: archived === false });
  const data =
    archived === undefined ? fields : { ...fields, archivedAt: archived ? new Date() : null };
  return conflictOnUnique(() => db.product.update({ where: { id }, data }), DUPLICATE_SKU);
}
