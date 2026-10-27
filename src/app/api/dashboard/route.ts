import { withTenantRoute } from "@/modules/platform/tenant-route";
import { getDashboard } from "@/modules/stock/dashboard-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Every tenant role may read the dashboard, so there is no `requires`: the service narrows every figure
// to ctx.warehouseIds. No cache (BL27 was removed): each call reads the database.
export const GET = withTenantRoute(async (_request, _parsed, { ctx, db }) =>
  Response.json(await getDashboard(db, ctx)),
);
