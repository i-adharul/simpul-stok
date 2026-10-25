import { env } from "@/lib/env";
import { withApiLog } from "@/lib/api-handler";
import { db } from "@/lib/db";
import { createLoginHandler, loginRoute } from "@/modules/platform/login-handler";

// Public (no session yet). Never cached: the response carries a Set-Cookie.
export const dynamic = "force-dynamic";
// bcryptjs, jose and the pg driver need Node APIs, so never the Edge runtime.
export const runtime = "nodejs";

// Static route, so withApiLog logs the real path; the body (email, password) is never logged.
export const POST = withApiLog(createLoginHandler({ prisma: db, secret: env.SESSION_SECRET }), {
  ...loginRoute,
});
