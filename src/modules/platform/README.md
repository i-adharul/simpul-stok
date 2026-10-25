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
- **Route order** in `withTenantRoute`: context (401, 403), input (400), handler.
- **Unique violations:** Prisma `P2002` is not mapped here. The service maps it to 409 (a shared helper comes
  in E3-01).
- **Not on `TenantClient`:** `$connect`, `$disconnect`, `$on`, `$extends` and raw SQL.
