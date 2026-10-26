import { withTenantRoute } from "@/modules/platform/tenant-route";
import { createProductBody, listProductsQuery } from "@/modules/stock/product-schema";
import { createProduct, listProducts } from "@/modules/stock/product-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// `requires` makes a role without the right get 403 before the query or body is validated.
export const GET = withTenantRoute(
  async (_request, { query }, { ctx, db }) => Response.json(await listProducts(db, ctx, query)),
  { requires: "product.read", query: listProductsQuery },
);

export const POST = withTenantRoute(
  async (_request, { body }, { ctx, db }) =>
    Response.json(await createProduct(db, ctx, body), { status: 201 }),
  { requires: "product.manage", body: createProductBody },
);
