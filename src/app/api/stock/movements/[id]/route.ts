import { withTenantRoute } from "@/modules/platform/tenant-route";
import { movementIdParams } from "@/modules/stock/stock-schema";
import { getMovement } from "@/modules/stock/stock-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// history.read is warehouse-level (no `requires`); the service hides movements outside the caller's
// warehouses with the same 404 as a missing id.
export const GET = withTenantRoute(
  async (_request, { params }, { ctx, db }) => Response.json(await getMovement(db, ctx, params.id)),
  { route: "/api/stock/movements/[id]", params: movementIdParams },
);
