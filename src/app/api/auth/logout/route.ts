import { withApiLog } from "@/lib/api-handler";
import { createLogoutHandler } from "@/modules/platform/me-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withApiLog(createLogoutHandler(), { body: "none" });
