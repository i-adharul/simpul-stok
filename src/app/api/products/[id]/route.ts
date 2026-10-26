import { withTenantRoute } from "@/modules/platform/tenant-route";
import { productIdParams, updateProductBody } from "@/modules/stock/product-schema";
import { getProduct, updateProduct } from "@/modules/stock/product-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const route = "/api/products/[id]";

export const GET = withTenantRoute(
  async (_request, { params }, { ctx, db }) => Response.json(await getProduct(db, ctx, params.id)),
  { route, requires: "product.read", params: productIdParams },
);

export const PATCH = withTenantRoute(
  async (_request, { params, body }, { db }) =>
    Response.json(await updateProduct(db, params.id, body)),
  { route, requires: "product.manage", params: productIdParams, body: updateProductBody },
);
