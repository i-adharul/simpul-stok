# Tests: shared helpers

Vitest runs against a real Postgres. `TEST_DATABASE_URL` must name a database that ends in `_test`.
`vitest.config.mts` points `DATABASE_URL` at it for the test workers, and `global-setup.ts` stops the whole
run if the two ever name a different host, port or database.

| File                | Purpose                                                               |
| ------------------- | --------------------------------------------------------------------- |
| `global-setup.ts`   | Checks the test database, applies migrations once per run             |
| `test-database.ts`  | `createTestPrisma`, `assertTestDatabaseUrl`, `assertSameTestDatabase` |
| `tenant-isolation/` | The cross-tenant harness (below)                                      |

`api-docs.test.ts` fails when a `route.ts` under `src/app/api` has no `### \`METHOD /path\``section in`docs/04_API_Spec.md`; document the endpoint in the same story.

## Cross-tenant harness (BL03)

Proves that organization A cannot read, change or delete organization B's data. No HTTP server: the exported
Route Handler is called with a `Request` that carries a session cookie and a same-origin `Origin` header,
against the test database. Design: issue #38.

| File                        | Purpose                                                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registry.ts`               | `TENANT_ENDPOINTS`: one entry per tenant endpoint and method                                                                                              |
| `exemptions.ts`             | `EXEMPT_ROUTES` (tenant, with reason) and `PUBLIC_ROUTES` (not tenant, with reason)                                                                       |
| `fixtures.ts`               | Two organizations, each with an owner, a warehouse admin, a viewer, warehouses, a product and a transfer; plus a platform admin; `cookieFor`, `callRoute` |
| `run-harness.ts`            | The checks and `describeTenantIsolation(endpoints)`                                                                                                       |
| `inventory.ts` / `.test.ts` | Fails CI when a `route.ts` is in no list, or in more than one                                                                                             |
| `tenant-isolation.test.ts`  | Runs the harness on the registry. You do not edit it.                                                                                                     |
| `test-routes.ts`            | Test-only warehouse routes, correct and with one deliberate flaw each                                                                                     |
| `harness.selftest.test.ts`  | Proves the harness passes the correct route and catches every flaw                                                                                        |

### Register a new endpoint (same story as the endpoint)

1. Add the entry to `TENANT_ENDPOINTS` in `registry.ts`, one per HTTP method:

```ts
{
  kind: "item",
  name: "PATCH /api/warehouses/[id]",
  route: "warehouses/[id]",                       // folder below src/app/api
  method: "PATCH",
  module: () => import("@/app/api/warehouses/[id]/route"),
  action: "warehouse.manage",                     // the permission the route enforces (can.ts)
  allowedRoles: rolesFor("warehouse.manage"),     // never hand-written; every other role must get 403
  idParam: "id",
  path: (id) => `/api/warehouses/${id}`,
  body: () => ({ name: "Renamed" }),              // a VALID body, so the handler is reached
  createRow: async (t, owner) => /* insert with t.prisma for t[owner].organizationId, return the id */,
  readRow: async (prisma, id) => /* the columns the endpoint may change, plus organizationId */,
}
```

For a `kind: "create"` entry whose body carries ids, add `foreignBodies(t)`: one variant per foreign key, each with
the other keys valid, a `missingBody` with a random UUID in the same place, and the expected `status` (403 when the
service authorizes the key first, as for a warehouse; 404 when it looks the key up, as for a product). The harness
check "foreign key of another organization gets the same response as a missing one" needs the two answers to be
byte-identical and nothing written. `readRow(prisma, t)` (optional) returns state that `countRows` does not see,
for example the stock quantity of the pair, and must be unchanged afterwards. E5 transfers reuse it for the
destination warehouse. `inventory.test.ts` enforces it: a write under `stock/`, `transfers` or `imports`
whose `body(t)` holds a key ending in `Id` with a UUID needs one `foreignBodies` variant per such key, replacing
exactly that key (and a `missingBody` that replaces the same key); otherwise CI fails.

Use `kind: "list"` (`path`, `createRow`, `idsOf`, optional `supportsCursor` and `encodeCursor`) for a list,
and `kind: "create"` (`path`, `body`, `countRows`) for a POST that creates a row.
Unique columns (sku, code) in `createRow` can use `t.unique("x")`; warehouse codes and SKUs must be uppercase. 2. A route that cannot be tested this way goes in `EXEMPT_ROUTES` with a reason. A route that is not a tenant
route at all goes in `PUBLIC_ROUTES` (it must not use `withTenantRoute`). 3. Run `pnpm test`. `inventory.test.ts` names the route that is missing.

Stock write endpoints (receive, adjust, transfer, import commit) also set `idempotent: true` on the entry. The
harness then sends a fresh `Idempotency-Key` with every request and adds two checks: "write without a valid
Idempotency-Key gets 400" and "same key twice gives one effect and the same body" (same status, identical
body, `Idempotency-Replayed: true` only on the second response, one row created or the row not changed
again). A route that declares `idempotent: true` but never calls `runIdempotent` fails the second check. `inventory.test.ts` requires it for routes starting with `stock/`, `transfers` or
`imports`; a real exception goes in `IDEMPOTENCY_EXEMPT` (`exemptions.ts`) with a reason. `idempotency/test-routes.ts`
holds a test-only stock write used to prove the wrapper (`modules/platform/idempotency.test.ts`).

Notes:

- **Organization-level actions** (`warehouse.read`, `product.read`, `warehouse.manage`, `product.manage`,
  `member.manage`, `subscription.manage`) are passed to `withTenantRoute` as `requires`, which checks them after
  the session and BEFORE the input, so a role without the right gets 403 and learns nothing about the body. The
  harness checks this with an invalid body (`{}`) for write endpoints. **Warehouse-level actions** (`stock.*`,
  `history.read`) cannot be passed as `requires`: they need a `warehouseId`, so the handler calls `authorize()`
  itself, after validation. The "invalid body" check does not apply to them.
- Handlers validate the input before they authorize, so the harness sends a valid body: a 400 would hide the
  403/404 being checked.
- A route that hides `withTenantRoute` behind a helper file is still found: the guard it installs carries a marker
  (`isTenantGuard`) that the inventory reads from the loaded module.
- Fixtures write with the plain Prisma client on purpose (they arrange data in both organizations).
