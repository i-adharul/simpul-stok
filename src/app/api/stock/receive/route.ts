import { authorize } from "@/modules/platform/can";
import { markReplayed } from "@/modules/platform/idempotency";
import { withTenantRoute } from "@/modules/platform/tenant-route";
import { receiveBody } from "@/modules/stock/stock-schema";
import { movementBody, receiveStock } from "@/modules/stock/stock-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A warehouse-level action cannot be `requires`: it needs the warehouseId from the body, so the
// handler authorizes first (before runIdempotent, ADR 0012), then the service does the work.
export const POST = withTenantRoute(
  async (_request, { body }, { ctx, db, idempotencyKey }) => {
    authorize(ctx, "stock.receive", { warehouseId: body.warehouseId });
    const { result, replayed } = await receiveStock(db, ctx, idempotencyKey, body);
    return markReplayed(Response.json(movementBody(result), { status: 201 }), replayed);
  },
  { idempotent: true, body: receiveBody },
);
