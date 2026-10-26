# Platform module

Cross-cutting concerns that any future Simpul module would share:

- authentication and sessions
- organizations, members and invitations
- plans, subscriptions and billing (Xendit sandbox)
- platform admin

Dependency rule: this module must not import from `modules/stock`.
See `docs/decisions/0002-module-boundaries.md`.

## Tenant-scoped client (BL03)

Tenant data is reached only through `createTenantClient(prisma, ctx)` (`tenant-client.ts`). Handlers get it
from `withTenantRoute` (`tenant-route.ts`) as `{ ctx, db }`; services take the `TenantClient` type. See
[ADR 0011](../../../docs/decisions/0011-tenant-scoped-client-and-lint.md).

| Operation                                                                | What the client does                                                                               |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `findMany`, `findFirst*`, `findUnique*`, `count`, `aggregate`, `groupBy` | adds `organizationId` to `where`; another tenant's ID returns `null` (404 for `...OrThrow`)        |
| `create`, `createMany*`                                                  | sets `organizationId` from the session; a different value throws                                   |
| `update`, `updateMany*`, `delete`, `deleteMany`, `upsert`                | scoped `where`; `organizationId` in update data throws; no match on a single row is `ApiError` 404 |
| `$queryRaw*`, `$executeRaw*`                                             | refused (also by ESLint)                                                                           |

- **Models:** the 14 with `organizationId` (`TENANT_MODELS`). `Organization` is scoped by `id` and a tenant may
  change only `name` and `address` (allowlist). `Subscription` and `Plan` are read-only. `WebhookEvent` is refused.
- **Writes take scalar columns only** (`warehouseId: "..."`, not `warehouse: { connect }`). Nested writes skip
  the hook, so they throw.
- **Foreign keys are NOT validated by the client.** A service must read every ID it uses as a foreign key
  through the tenant client before writing (E2-05, issue #35, adds the ownership helper).
- **Lint:** only the files in `PLAIN_CLIENT_ALLOWLIST` (`eslint.config.mjs`) may import `@/lib/db` or the
  `PrismaClient` type. Raw SQL needs an entry in `RAW_SQL_ALLOWLIST` that cites an ADR.
- **New tenant table:** add it to `TENANT_MODELS`; `tenant-client.test.ts` fails until you do.
- **Route order** in `withTenantRoute`: context (401, 403), `requires` (403), input (400), handler. `requires`
  takes an organization-level action only (`warehouse.*`, `product.*`, `member.manage`, `subscription.manage`).
  Warehouse-level actions (`stock.*`, `history.read`) need a `warehouseId`, so the handler calls `authorize()`
  itself, after validation.
- **Unique violations:** Prisma `P2002` is not mapped here. The service maps it to 409 (a shared helper comes
  in E3-01).
- **Not on `TenantClient`:** `$connect`, `$disconnect`, `$on`, `$extends` and raw SQL.
- **Cross-tenant tests:** a new tenant endpoint is registered in `src/test/tenant-isolation/registry.ts` in the
  same story (or listed with a reason in `exemptions.ts`); `inventory.test.ts` fails CI otherwise. See
  `src/test/README.md`.
- **404:** throw `notFoundError()` from `src/lib/api-error.ts`. It is the only definition of the message, so a
  missing row and another organization's row produce byte-identical bodies.

## Idempotency-Key (BL14, ADR 0012)

Stock writes are safe to retry. `idempotency.ts` holds `parseIdempotencyKey`, `runIdempotent` and `markReplayed`;
`withTenantRoute({ idempotent: true })` reads the header and gives the handler `tenant.idempotencyKey`.

```ts
authorize(ctx, "stock.receive", { warehouseId }); // 1. ALWAYS first: never replay to a caller who may not act
const { result, replayed } = await runIdempotent(
  db,
  { key: tenant.idempotencyKey, endpoint: "POST /api/stock/receive" },
  {
    work: async (tx) => (await tx.stockMovement.create({ data })).id, // 2. the effect; returns the new resource ID
    load: (db, id) => loadMovement(db, id), // 3. the response is built from this, first call and replay
    access: { ctx, action: "stock.receive", warehouseIdOf: (row) => row.warehouseId }, // 4. replay is authorized again; 404 if not
  },
);
return markReplayed(Response.json(body(result), { status: 201 }), replayed);
```

- The key row is the last statement of the transaction; a duplicate rolls back `work` and replays the first result.
- `endpoint` is a constant chosen by the handler, never taken from the URL (no IDs in the key).
- Register the endpoint with `idempotent: true`; see `src/test/README.md`.
