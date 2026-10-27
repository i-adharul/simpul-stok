import { authorize } from "@/modules/platform/can";
import { markReplayed } from "@/modules/platform/idempotency";
import { withTenantRoute } from "@/modules/platform/tenant-route";
import { transferBody } from "@/modules/stock/stock-schema";
import { transferStock } from "@/modules/stock/stock-transfer-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Same shape as receive and adjust: authorize the SOURCE warehouse from the body first (before
// runIdempotent, ADR 0012); the service checks the destination and products. The answer is the immutable
// transfer (loadTransfer), never stock balances, so a replay equals the first response.
export const POST = withTenantRoute(
  async (_request, { body }, { ctx, db, idempotencyKey }) => {
    authorize(ctx, "stock.transfer", { warehouseId: body.fromWarehouseId });
    const { result, replayed } = await transferStock(db, ctx, idempotencyKey, body);
    return markReplayed(Response.json(result, { status: 201 }), replayed);
  },
  { idempotent: true, body: transferBody },
);
