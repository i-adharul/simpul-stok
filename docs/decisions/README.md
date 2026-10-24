# Architecture decision records

One file per decision. A decision that is replaced stays in the list with its status changed.

| No   | Title                                                                                                                                 | Status   | Story |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----- |
| 0001 | [Next.js as a single fullstack codebase](0001-nextjs-fullstack.md)                                                                    | accepted | E0-01 |
| 0002 | [Module boundaries (platform and stock)](0002-module-boundaries.md)                                                                   | accepted | E0-01 |
| 0003 | [Database conventions (IDs, names, times, deletes, rules in SQL)](0003-database-conventions.md)                                       | accepted | E0-04 |
| 0004 | [Stay on Prisma ORM 7 and postpone Prisma ORM 8](0004-stay-on-prisma-7.md)                                                            | accepted | E0-04 |
| 0005 | [Immutable stock movements enforced by a database trigger](0005-immutable-stock-movements-trigger.md)                                 | accepted | E0-05 |
| 0006 | [Tenant integrity enforced by the application, not composite foreign keys](0006-tenant-integrity-in-application.md)                   | accepted | E0-05 |
| 0007 | [Neon and Vercel connection strategy (pooled for the app, direct and manual for migrations)](0007-neon-vercel-connection-strategy.md) | accepted | E0-08 |
