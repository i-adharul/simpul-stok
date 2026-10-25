import { env } from "@/lib/env";
import { withApiLog } from "@/lib/api-handler";
import { db } from "@/lib/db";
import {
  changePasswordRoute,
  createChangePasswordHandler,
} from "@/modules/platform/password-change-handler";

// Depends on the cookie and sets a new one, so never cached.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Static route: the body (both passwords) is never logged by withApiLog.
export const PATCH = withApiLog(
  createChangePasswordHandler({ prisma: db, secret: env.SESSION_SECRET }),
  changePasswordRoute,
);
