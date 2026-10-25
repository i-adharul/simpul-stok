const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Public endpoints that browsers never call with our cookie. The Xendit webhook is authenticated by
// its callback token instead (docs/04_API_Spec.md). Matched by exact path or sub-path, not prefix.
const EXEMPT_PATHS = ["/api/webhooks/xendit"];

export type OriginCheck =
  { ok: true } | { ok: false; reason: "origin_missing" | "origin_mismatch" };

type OriginInput = {
  method: string;
  pathname: string;
  // The host the browser addressed (x-forwarded-host or host), so preview URLs match themselves.
  host: string | null;
  origin: string | null;
};

function isExempt(pathname: string): boolean {
  return EXEMPT_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

// Cookie-authenticated writes must come from our own origin (docs/05 "CSRF"). Comparing against the
// request's own host, not an env list, keeps localhost, production and Vercel previews working.
export function checkOrigin(input: OriginInput): OriginCheck {
  if (!WRITE_METHODS.has(input.method.toUpperCase())) return { ok: true };
  if (isExempt(input.pathname)) return { ok: true };
  if (!input.origin) return { ok: false, reason: "origin_missing" };
  if (!input.host) return { ok: false, reason: "origin_mismatch" };

  let originHost: string;
  try {
    originHost = new URL(input.origin).host;
  } catch {
    return { ok: false, reason: "origin_mismatch" };
  }
  // "null" (sandboxed iframes, redirects) parses to an error above and is rejected.
  return originHost === input.host.toLowerCase()
    ? { ok: true }
    : { ok: false, reason: "origin_mismatch" };
}
