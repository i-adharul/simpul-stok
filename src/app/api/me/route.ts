import { env } from "@/lib/env";
import { withApiLog } from "@/lib/api-handler";
import { db } from "@/lib/db";
import { createMeHandler } from "@/modules/platform/me-handler";

// Depends on the cookie, so never cached or prerendered.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withApiLog(createMeHandler({ prisma: db, secret: env.SESSION_SECRET }));
