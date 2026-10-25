type Header = { key: string; value: string };

// No script-src on purpose: a strict script policy needs per-request nonces and fully dynamic
// rendering in Next.js. These directives close framing, plugins and base/form hijacking without that cost.
const CSP = [
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export function securityHeaders(): Header[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    { key: "Content-Security-Policy", value: CSP },
    // Browsers ignore HSTS received over plain http, so the dev server is not pinned to https.
    // Sent unconditionally to avoid reading process.env in next.config.ts (CLAUDE.md rule 5).
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  ];
}
