# ADR 0010: CSRF protection by an Origin check in the proxy

- Status: accepted
- Date: 2026-10-25

## Context

The session is a cookie ([ADR 0009](0009-stateless-signed-session.md)), so a page on another site can make the
browser send write requests that carry it. Story E1-06 needed a defence that covers login, logout, password
change and every later write route without each handler remembering to apply it.

## Decision

- `src/proxy.ts` runs before any route. Every write request (`POST`, `PUT`, `PATCH`, `DELETE`) must carry an
  `Origin` header whose scheme and host equal those of the request itself.
- The scheme comes from `x-forwarded-proto` (first entry) or the URL; the host comes from `x-forwarded-host`
  or `Host`. Comparing against the request, not a configured list, keeps localhost, production and Vercel
  preview URLs working.
- A missing, unparsable (including `null`), or different `Origin` is answered with 403 `CSRF_REJECTED` and
  logged as `csrf.rejected` (method, path and reason only; never headers, cookies or body).
- Only the Xendit webhook (`/api/webhooks/xendit`) is exempt; it is authenticated by its callback token.
- Safe methods (`GET`, `HEAD`, `OPTIONS`) are not checked.

## Alternatives considered

- **A separate CSRF token (double submit cookie).** Rejected: needs token issuing, a second cookie and
  client code on every write, for a same-origin app where the `Origin` header already carries the signal.
- **Relying only on `SameSite=Lax`.** Rejected: it is a good second layer but one browser setting, and it does
  not stop same-site attackers (a sibling subdomain).
- **A fixed list of allowed origins in the environment.** Rejected: every preview URL would need an entry, and a
  stale list fails silently.

## Consequences

- Non-browser clients (curl, REST clients) must send an `Origin` equal to the server's own origin, or they get 403. The README documents this and `http/auth.http` shows it.
- The 403 is produced by the proxy, so it has no status or duration log line from `withApiLog`.
- The Content-Security-Policy has no `script-src` yet; it needs a per-request nonce and is planned for the M4
  security review.
