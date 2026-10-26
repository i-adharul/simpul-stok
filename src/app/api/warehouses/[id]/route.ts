import { withTenantRoute } from "@/modules/platform/tenant-route";
import { updateWarehouseBody, warehouseIdParams } from "@/modules/stock/warehouse-schema";
import { getWarehouse, updateWarehouse } from "@/modules/stock/warehouse-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const route = "/api/warehouses/[id]";

export const GET = withTenantRoute(
  async (_request, { params }, { ctx, db }) =>
    Response.json(await getWarehouse(db, ctx, params.id)),
  { route, requires: "warehouse.read", params: warehouseIdParams },
);

export const PATCH = withTenantRoute(
  async (_request, { params, body }, { db }) =>
    Response.json(await updateWarehouse(db, params.id, body)),
  { route, requires: "warehouse.manage", params: warehouseIdParams, body: updateWarehouseBody },
);
