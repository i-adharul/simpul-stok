import { env } from "@/lib/env";
import { withApiLog } from "@/lib/api-handler";
import { pingDatabase } from "@/lib/db";
import { createHealthChecker, toHealthResponse } from "@/modules/platform/health";

// Public on purpose (no session): uptime monitors and the deploy check call it.
// Never cached: a cached "ok" would hide a real outage. The database result is cached inside
// the checker instead, for 60 s, to protect the Neon free quota.
export const dynamic = "force-dynamic";

// Module scope so the 60 s cache survives between requests handled by the same instance.
const checkHealth = createHealthChecker({
  ping: pingDatabase,
  now: Date.now,
  ttlMs: 60_000,
  timeoutMs: 8_000, // far longer than a Neon wake-up from idle (a few hundred ms)
});

export const GET = withApiLog(async () => {
  const { status, body } = toHealthResponse(await checkHealth(), env.VERCEL_GIT_COMMIT_SHA);
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
});
