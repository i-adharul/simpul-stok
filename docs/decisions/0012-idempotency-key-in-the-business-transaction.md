# ADR 0012: Idempotency by a key row written in the same transaction as the business effect

- Status: accepted
- Date: 2026-10-26

## Context

A client that retries a stock write (receive, adjust, transfer, import commit) after a timeout must not
change stock twice (BL14). The database is the only source of truth: no cache, no Redis
([docs/05](../05_Technical_Design.md)). The table `idempotency_keys` already exists with a primary key on
`(organization_id, key, endpoint)` and an index on `created_at`. Its `resource_id` is NOT NULL, so the row can
only be written once the created resource has an ID. Story E4-01 needed one helper that every stock write
endpoint uses.

## Decision

- **`runIdempotent(db, { key, endpoint }, { work, load, access })`** in `modules/platform/idempotency.ts`.
  `withTenantRoute({ idempotent: true })` reads the `Idempotency-Key` header of a write method, requires a UUID
  (stored in lower case) and hands it to the handler. A missing or malformed key is a 400, checked after the
  session and `requires` and before the body.
- **Order of a request.** (1) The handler calls `authorize()` for the warehouse. (2) `runIdempotent` looks the
  key up (pre-check); a hit goes to step 5. (3) Otherwise one `$transaction` runs `work` and then inserts the
  key row as its LAST statement (because `resource_id` is NOT NULL; no migration). (4) If the transaction fails
  for ANY reason and the key exists now, a twin finished first, so go to step 5; if it does not exist, the error
  is thrown unchanged. (5) The response is built from `load(resourceId)` for the first call and for a replay
  alike, so the two cannot differ, and a replay adds `Idempotency-Replayed: true`. The body of the repeated
  request is not compared.
- **Authorize before the pre-check.** The pre-check answers from the table. If it ran first, a user who may not
  act (a Viewer) could be shown a replay. The handler therefore authorizes first, and a replay is authorized
  again against the warehouse of the LOADED resource (`access`): a user who may not see it gets the same 404 as
  a missing resource (rule 2), never 403, so a key of another warehouse reveals nothing.
- **Race analysis.** Two requests with the same key both pass the pre-check and both run `work`. The first
  inserts the key and commits. The second blocks on the unique index at its own key insert and fails with
  P2002 after that commit; its transaction, including `work`, rolls back. Only one effect survives. Row locks
  taken by `work` (stock rows) make the second request wait for the first even earlier.
- **Why the re-check covers every error, not only P2002.** `work` of the second request runs on top of the first
  one's committed data. It can fail on its business rule first (for example INSUFFICIENT_STOCK after the first
  request used the last units) and never reach the key insert. Looking at the table after any failure turns that
  into a replay. A genuine error, with no key stored, is not hidden. Cost: a failed lookup is ignored so the
  original error is the one reported.
- **Explicit transaction limits.** `maxWait` and `timeout` are 10 s. Prisma 7's defaults (`maxWait` 2 s, `timeout` 5 s) are too short for a
  request that waits on a row lock or on the unique index under load, and a timeout would roll back a request
  that was correct.
- **Registry guard.** A registry entry may set `idempotent: true`; the harness then proves a write without a
  valid key gets 400 (check "write without a valid Idempotency-Key gets 400") and a self-test flaw proves the
  check catches a route that ignores the header. A second check sends the same valid request twice with one
  key and requires one effect, an identical body and `Idempotency-Replayed: true` on the second answer only, so
  the harness proves for every stock endpoint that it really uses `runIdempotent`. `inventory.test.ts` requires the option on every write whose
  route starts with `stock/`, `transfers` or `imports`, except entries in `IDEMPOTENCY_EXEMPT` with a reason.

## Alternatives considered

- **Key row first with a nullable `resource_id`.** Needs a migration and leaves a row without a resource if
  the process dies between the statements. Rejected by the story.
- **A status column (`PROCESSING`/`DONE`) and a reservation before the work.** Closes the parallel-work window
  but needs a migration, a rule for stuck reservations and a polling client. Not needed at this scale.
- **Catching only P2002.** Misses the business-error race above.
- **Redis or an in-memory cache.** Rejected in the PRD: the unique key already guarantees it.
- **Comparing the request body and answering 422 on a mismatch.** BL14 says the body is not compared.

## Consequences

- No migration. `created_at` is already indexed for the cleanup.
- In a race, `work` runs twice and one run is rolled back. This is wasted work, not a wrong result.
- **Known limitation:** two parallel requests with the SAME key but DIFFERENT bodies give the first one's
  result to both. This is a client misuse (a key identifies one intent) and is accepted.
- A replay shows the CURRENT state of the resource, not a snapshot. For an immutable `StockMovement` this is the
  same thing; for a mutable resource (for example a transfer status) the shape is the same and the values may
  have moved on.
- A request that failed leaves no key, so its retry runs again, which is what the client wants.
- The 24-hour cleanup of old keys (BL24) is the cron of E10-04 and is not part of this decision. Until it
  runs, a key stays valid for longer than 24 hours.
- An endpoint that forgets `authorize()` before `runIdempotent` is a coding mistake; the handler convention is
  in `modules/platform/README.md` and CLAUDE.md rule 17, and the cross-tenant harness catches a role without
  permission that still gets a result.
- A Viewer who sends no key to a stock write gets 400 instead of 403, because the key is checked before the
  handler's warehouse-level `authorize()`. Nothing about any resource is revealed.
