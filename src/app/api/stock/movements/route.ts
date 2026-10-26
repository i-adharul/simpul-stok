import { withTenantRoute } from "@/modules/platform/tenant-route";
import { listMovementsQuery } from "@/modules/stock/stock-schema";
import { listMovements } from "@/modules/stock/stock-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// history.read is warehouse-level, so there is no `requires`: every tenant role may read, and the
// service narrows the rows to ctx.warehouseIds (an Owner has all active warehouses).
export const GET = withTenantRoute(
  async (_request, { query }, { ctx, db }) => Response.json(await listMovements(db, ctx, query)),
  { query: listMovementsQuery },
);
