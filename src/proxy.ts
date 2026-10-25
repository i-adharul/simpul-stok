import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkOrigin } from "./lib/csrf";
import { errorResponse } from "./lib/api-error";
import { REQUEST_ID_HEADER, resolveRequestId } from "./lib/request-id";

// Only assigns the request ID. The proxy runs before the handler, so it cannot know the status or
// duration; those are logged by withApiLog (src/lib/api-handler.ts) for API routes only.
export function proxy(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));

  // CSRF: reject cross-site writes before any handler (login included) runs.
  const check = checkOrigin({
    method: request.method,
    pathname: request.nextUrl.pathname,
    host: request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
    origin: request.headers.get("origin"),
  });
  if (!check.ok) {
    const denied = errorResponse(403, "CSRF_REJECTED", "Request origin is not allowed.");
    denied.headers.set(REQUEST_ID_HEADER, requestId);
    return denied;
  }

  // Set on the request so the handler sees it, and on the response so the caller can quote it.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  // Skip static assets: they need no ID and should not pay for the proxy.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)",
  ],
};
