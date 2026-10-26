import { withTenantRoute } from "@/modules/platform/tenant-route";
import { createWarehouseBody, listWarehousesQuery } from "@/modules/stock/warehouse-schema";
import { createWarehouse, listWarehouses } from "@/modules/stock/warehouse-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// `requires` makes a role without the right get 403 before the query or body is validated.
export const GET = withTenantRoute(
  async (_request, { query }, { ctx, db }) => Response.json(await listWarehouses(db, ctx, query)),
  { requires: "warehouse.read", query: listWarehousesQuery },
);

export const POST = withTenantRoute(
  async (_request, { body }, { ctx, db }) =>
    Response.json(await createWarehouse(db, ctx, body), { status: 201 }),
  { requires: "warehouse.manage", body: createWarehouseBody },
);
