import { withTenantRoute } from "@/modules/platform/tenant-route";
import { movementIdParams } from "@/modules/stock/stock-schema";
import { getTransfer } from "@/modules/stock/stock-transfer-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// history.read is warehouse-level (no `requires`); the service shows the transfer only when the caller
// may see its source or destination, and answers every other case with the same 404 as a missing id.
export const GET = withTenantRoute(
  async (_request, { params }, { ctx, db }) => Response.json(await getTransfer(db, ctx, params.id)),
  { route: "/api/stock/transfers/[id]", params: movementIdParams },
);
