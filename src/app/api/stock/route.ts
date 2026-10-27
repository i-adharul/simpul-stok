import { withTenantRoute } from "@/modules/platform/tenant-route";
import { listStockQuery } from "@/modules/stock/stock-schema";
import { listStock } from "@/modules/stock/stock-level-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// stock.read is warehouse-level, so there is no `requires`: every tenant role may read, and the
// service narrows the rows to ctx.warehouseIds (and authorizes a requested warehouseId first).
export const GET = withTenantRoute(
  async (_request, { query }, { ctx, db }) => Response.json(await listStock(db, ctx, query)),
  { query: listStockQuery },
);
