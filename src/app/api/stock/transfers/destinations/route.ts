import { withTenantRoute } from "@/modules/platform/tenant-route";
import { listTransferDestinations } from "@/modules/stock/stock-transfer-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Organization-level action, so `requires` rejects a Viewer with 403 before anything is read.
export const GET = withTenantRoute(
  async (_request, _input, { db }) => Response.json(await listTransferDestinations(db)),
  { requires: "transfer.destinations" },
);
