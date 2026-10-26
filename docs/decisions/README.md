# Architecture decision records

One file per decision. A decision that is replaced stays in the list with its status changed.

| No   | Title                                                                                                                                  | Status   | Story |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----- |
| 0001 | [Next.js as a single fullstack codebase](0001-nextjs-fullstack.md)                                                                     | accepted | E0-01 |
| 0002 | [Module boundaries (platform and stock)](0002-module-boundaries.md)                                                                    | accepted | E0-01 |
| 0003 | [Database conventions (IDs, names, times, deletes, rules in SQL)](0003-database-conventions.md)                                        | accepted | E0-04 |
| 0004 | [Stay on Prisma ORM 7 and postpone Prisma ORM 8](0004-stay-on-prisma-7.md)                                                             | accepted | E0-04 |
| 0005 | [Immutable stock movements enforced by a database trigger](0005-immutable-stock-movements-trigger.md)                                  | accepted | E0-05 |
| 0006 | [Tenant integrity enforced by the application, not composite foreign keys](0006-tenant-integrity-in-application.md)                    | accepted | E0-05 |
| 0007 | [Neon and Vercel connection strategy (pooled for the app, direct and manual for migrations)](0007-neon-vercel-connection-strategy.md)  | accepted | E0-08 |
| 0008 | [Vercel function region matches the Neon region](0008-vercel-region-matches-neon.md)                                                   | accepted | E0-08 |
| 0009 | [Stateless signed session cookie (no session table)](0009-stateless-signed-session.md)                                                 | accepted | E1-02 |
| 0010 | [CSRF protection by an Origin check in the proxy](0010-csrf-origin-check-in-proxy.md)                                                  | accepted | E1-06 |
| 0011 | [Tenant isolation by a Prisma client extension, enforced by lint and a route guard](0011-tenant-scoped-client-and-lint.md)             | accepted | E2-04 |
| 0012 | [Idempotency by a key row written in the same transaction as the business effect](0012-idempotency-key-in-the-business-transaction.md) | accepted | E4-01 |
| 0013 | [Warehouse row lock as the serialization point for stock writes](0013-warehouse-row-lock-for-stock-writes.md)                          | accepted | E4-02 |
