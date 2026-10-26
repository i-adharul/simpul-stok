import { authorize } from "@/modules/platform/can";
import { markReplayed } from "@/modules/platform/idempotency";
import { withTenantRoute } from "@/modules/platform/tenant-route";
import { adjustmentBody, adjustStock } from "@/modules/stock/stock-adjust-service";
import { adjustBody } from "@/modules/stock/stock-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Same shape as receive: authorize with the warehouseId from the body first (before runIdempotent,
// ADR 0012), then the service does the work.
export const POST = withTenantRoute(
  async (_request, { body }, { ctx, db, idempotencyKey }) => {
    authorize(ctx, "stock.adjust", { warehouseId: body.warehouseId });
    const { result, replayed } = await adjustStock(db, ctx, idempotencyKey, body);
    return markReplayed(Response.json(adjustmentBody(result), { status: 201 }), replayed);
  },
  { idempotent: true, body: adjustBody },
);
