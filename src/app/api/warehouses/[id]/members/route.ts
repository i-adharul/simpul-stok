import { withTenantRoute } from "@/modules/platform/tenant-route";
import { replaceWarehouseMembersBody, warehouseIdParams } from "@/modules/stock/warehouse-schema";
import {
  listWarehouseMembers,
  replaceWarehouseMembers,
} from "@/modules/stock/warehouse-members-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const route = "/api/warehouses/[id]/members";

// member.manage is Owner only, checked before the input is read.
export const GET = withTenantRoute(
  async (_request, { params }, { db }) => Response.json(await listWarehouseMembers(db, params.id)),
  { route, requires: "member.manage", params: warehouseIdParams },
);

export const PUT = withTenantRoute(
  async (_request, { params, body }, { ctx, db }) =>
    Response.json(await replaceWarehouseMembers(db, ctx.organizationId, params.id, body.userIds)),
  {
    route,
    requires: "member.manage",
    params: warehouseIdParams,
    body: replaceWarehouseMembersBody,
  },
);
