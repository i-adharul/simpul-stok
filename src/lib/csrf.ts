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
  // "http" or "https" as the client used it (x-forwarded-proto behind a proxy, else the URL's own).
  scheme: string;
  origin: string | null;
};

// x-forwarded-proto may hold a list ("https,http") when several proxies add to it: the first entry
// is the one the client used.
export function requestScheme(forwardedProto: string | null, urlProtocol: string): string {
  const forwarded = forwardedProto?.split(",")[0].trim().toLowerCase();
  return forwarded || urlProtocol.replace(/:$/, "").toLowerCase();
}

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

  let origin: URL;
  try {
    origin = new URL(input.origin);
  } catch {
    return { ok: false, reason: "origin_mismatch" };
  }
  // "null" (sandboxed iframes, redirects) parses to an error above and is rejected. The scheme must
  // match too: an http page on the same host must not write to an https app.
  const sameScheme = origin.protocol === `${input.scheme.toLowerCase()}:`;
  return sameScheme && origin.host === input.host.toLowerCase()
    ? { ok: true }
    : { ok: false, reason: "origin_mismatch" };
}
