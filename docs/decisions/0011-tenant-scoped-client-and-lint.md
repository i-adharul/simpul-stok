# ADR 0011: Tenant isolation by a Prisma client extension, enforced by lint and a route guard

- Status: accepted
- Date: 2026-10-25

## Context

Every business table carries `organization_id`, and the database does not stop a query that forgets to
filter by it ([ADR 0006](0006-tenant-integrity-in-application.md)). A single forgotten `where` in a service
leaks another tenant's rows (BL03). Story E2-04 needed one mechanism that adds the filter, a way to stop
code from going around it, and a request flow in which a caller without access learns nothing.

## Decision

- **Prisma client extension.** `createTenantClient(prisma, ctx)` in `modules/platform/tenant-client.ts` uses
  one top-level `$allOperations` hook. It scopes every operation on the 14 models that have `organizationId`
  (reads, creates, updates, upserts, deletes). `Organization` is scoped by `id` (read, and update of `name` and `address` only: an allowlist, so any other
  or future column stays closed), `Subscription` and `Plan` are read-only, `WebhookEvent` is refused. Raw SQL is refused at runtime
  and hidden from the `TenantClient` type, together with `$connect`, `$disconnect` and `$on`. The hook also applies inside `$transaction`.
- **Fail closed.** A different `organizationId` in `where` or `data` throws instead of being overwritten. An
  unknown operation or model throws. Writes accept scalar columns only, so no relation input (`connect`,
  nested `create`) can bypass the hook. `include`/`select` may follow `organization` and `plan` as plain columns
  only, because anything reached through them (`organization.users`, `plan.subscriptions`) is not scoped.
- **404 for another tenant's row.** Prisma's `P2025` (update, delete, `...OrThrow` with no match) becomes
  `ApiError` 404 `NOT_FOUND`, identical to a missing ID (rule 2).
- **Lint.** `eslint.config.mjs` bans importing `@/lib/db` and the `PrismaClient` type, and bans
  `$queryRaw`/`$executeRaw` (and the `Unsafe` forms), everywhere except two explicit allowlists, one reason
  per entry. Services take `TenantClient`. A new raw SQL entry must cite an ADR.
- **Route guard.** `withApiLog` accepts an async `guard` that runs before the input is read.
  `withTenantRoute` uses it to resolve the request context first: 401 or 403, then 400 for invalid input, then
  the handler with `{ ctx, db }`. Platform admins get 403 and never a tenant client.
- **Billing writes bypass the tenant client.** `Subscription` is read-only for a tenant. The payment path
  (webhook and cron, which have no session) uses the plain client through an ADR-backed allowlist entry,
  decided in E8.
- **Foreign keys are not checked by the extension.** `warehouseId: <id of another tenant>` is a scalar and
  passes. A service must look up every ID it writes as a foreign key through the tenant client first
  (E2-05, issue #35, adds the ownership helper).

## Alternatives considered

- **Repository classes per model with an explicit `organizationId` argument:** readable, but every method
  must remember the argument, which is the mistake we want to make impossible. Much more code.
- **Postgres Row-Level Security now:** a stronger guarantee, but it needs a session variable per connection,
  which fits poorly with the pooler and the pg adapter. It stays the planned second layer (E13-11).
- **The extension alone, without lint:** a service could still import the plain client. Lint turns a code
  review item into a failing build.
- **Overwriting a conflicting `organizationId` silently:** hides a bug in the caller; throwing surfaces it.

## Consequences

- Services and handlers cannot (by lint and types) hold a plain client; the allowlist is the audited list of
  files that can.
- `create` data still needs `organizationId` at the type level (Prisma's unchecked input requires it); the
  hook fills it when absent and refuses a different value.
- Not covered: relation filters inside `where` (an existence oracle through a shared `plan`), and foreign
  key values. Both rely on the service rule above and on cross-tenant tests (E2-08).
- Every new tenant table must be added to `TENANT_MODELS`; a test fails otherwise.
- Revisit when RLS lands.
