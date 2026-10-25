# ADR 0009: Stateless signed session cookie (no session table)

- Status: accepted
- Date: 2026-10-25

## Context

Login (story E1-02, BL01) must give the browser a session that lasts 8 hours and that every later request
can check. The stack fixes the tools (own cookie, `jose`, `bcryptjs`; see
`docs/05_Technical_Design.md`), but not the shape of the session. The product also needs access to be cut
quickly: BL07 says deactivation takes effect at once, and BL01 says a session created before the last
password change is rejected.

## Decision

- The session is a **JWT signed with HS256** by `jose`, stored in a cookie named `__Host-simpul_session`:
  `httpOnly`, `Secure` (always, never read from `NODE_ENV`), `SameSite=Lax`, `Path=/`, no `Domain`. The
  `__Host-` prefix makes the browser refuse the cookie unless those conditions hold.
- The token holds only the subject (user ID), the issue time and the expiry. It does **not** hold the role,
  the organization or the status.
- The lifetime is **fixed at 8 hours** and is never extended.
- There is **no session table**. On every request the user is read again from the database; revocation works
  through `isActive` (BL07) and by comparing the token's issue time with `passwordChangedAt` (BL01).
- The key is `SESSION_SECRET` (at least 32 characters; the `.env.example` placeholder is rejected at startup).
  Verification pins the algorithm to HS256.
- A password longer than 72 bytes is refused at login rather than truncated or pre-hashed, and every failure
  (unknown email, wrong password, inactive user, over-long password) returns the same 401.

## Alternatives considered

- **Sessions stored in the database.** Rejected: one more table and one more query on every request for a
  benefit (revoking a single session) that the product does not need. The per-request user lookup already
  covers the revocation cases that matter.
- **Opaque random token (looked up server side).** Rejected for the same reason: it needs a store, and with
  no Redis in this version the store would be Postgres.
- **A sliding or refreshed session.** Rejected: BL01 asks for a fixed 8 hours, and a refresh would need a
  write or a new cookie on reads.
- **Role and organization inside the token.** Rejected: they could be stale for up to 8 hours after a role
  change or a deactivation.

## Consequences

- A single session cannot be revoked. Logging out only deletes the cookie; a stolen token stays valid until
  it expires (at most 8 hours) unless the user is deactivated or changes the password.
- Changing `SESSION_SECRET` signs everyone out, which is also the emergency revocation switch.
- Every request pays one user lookup; this is already needed for the subscription check (BL23).
- There is no rate limiting on login in this version (deferred, listed in the README under Known
  limitations). Combined with the point above, brute force is limited only by bcrypt's cost.
- CSRF protection for the login and other write routes (an `Origin` check) is scheduled in E1-06 (#28).
