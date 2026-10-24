# ADR 0003: Database conventions (IDs, names, times, deletes, rules in SQL)

- Status: accepted
- Date: 2026-10-24

## Context

Story E0-04 creates the first four tables (Organization, User, Plan, Subscription). Every later table
repeats the choices made here, so they are recorded once. Constraints that shaped them:

- The application is multi-tenant. A guessed ID that belongs to another organization must return 404,
  and the tenant filter is the real defence (`docs/03_Data_Model.md`, tenant isolation rules).
- Business data is archived, not deleted (CLAUDE.md rule 8). Dates are stored in UTC (rule 13).
- Some rules must hold no matter which code path writes the row: the application, a seed script, a
  test, or a manual SQL statement.

## Decision

- **IDs are UUID v7, created by the database.** Columns are `@db.Uuid` with
  `@default(dbgenerated("uuidv7()"))`, using the built-in `uuidv7()` function of PostgreSQL 18.
- **Names.** Prisma fields stay camelCase exactly as in `docs/03_Data_Model.md` (`organizationId`).
  Tables and columns are snake_case through `@@map` and `@map` (`users`, `organization_id`), and enum
  types too (`user_role`). SQL written by hand needs no quotes.
- **Time.** Every date column is `timestamptz(3)` (`@db.Timestamptz(3)`). `createdAt` is
  `@default(now())`. `updatedAt` is `@default(now()) @updatedAt`, so a raw INSERT does not fail on NOT NULL
  while Prisma still sets it on every update.
- **Deletes.** Every relation is `onDelete: Restrict`, written explicitly. The default for an optional
  relation is `SetNull`, which would turn a tenant user into a platform admin if an organization row were
  deleted.
- **Rules kept by the database, in custom SQL inside `migration.sql`.** One OWNER per organization
  (partial unique index), lowercase email, slug format, `billing_day` between 1 and 31, role and
  organization consistency (`PLATFORM_ADMIN` if and only if `organization_id` is empty), reset token and
  expiry filled together, subscription period order, and positive plan values. Each has a named
  constraint, and `src/modules/platform/schema-constraints.test.ts` proves each one.
  In the documentation read on 24 Oct 2026, `schema.prisma` has no syntax for CHECK constraints. Partial
  indexes are described as a Preview feature (`partialIndexes`) on one page, while another official page
  says they no longer need a custom migration, so the two pages do not fully agree. We use custom SQL
  through `prisma migrate dev --create-only`, which is the documented way to edit a migration.
- **Applied migrations are not edited.** A migration that was applied to a shared database (staging,
  production, or a teammate's) stays as it is; a change is a new migration.
- **Requires PostgreSQL 18** wherever the schema is applied. Local Docker and CI already use
  `postgres:18`. The production database on Neon must be created with Postgres 18.

## Alternatives considered

- **Integer auto-increment IDs:** easy to guess and enumerate, and they reveal how many rows exist.
  Tenant filtering would still return 404, but one layer of defence is lost.
- **cuid:** not guessable, but it is an ordinary string with no native type, so the index is larger.
- **UUID v4:** not guessable, but random, so inserts scatter across the B-tree index. v7 is ordered by time.
- **UUID v7 created by Prisma (`uuid(7)`):** the value is made in the client only, so a seed, a manual SQL
  insert or a raw-SQL test would get no ID. Creating it in the database covers every writer.
- **Prisma default names (`"Organization"`) and camelCase columns:** every `psql` command, custom
  constraint and future Row-Level Security policy would need quotes.
- **`timestamp` without time zone:** the meaning depends on the session time zone. `timestamptz` stores
  an instant in UTC.
- **`SetNull` or `Cascade` on delete:** both break the "archive, never delete" rule.
- **Keep these rules in the application only:** a seed, a test, or a bug can write bad rows. The database
  is the last line (the same idea as the `CHECK (quantity >= 0)` on stock).
- **The `partialIndexes` Preview feature:** would put the Owner index in `schema.prisma`, but a Preview
  feature may change, and the documentation pages disagree about its status.

## Consequences

- One thing has two names: `organizationId` in code and `organization_id` in SQL. Prisma translates, but
  anyone reading SQL or logs has to know the rule.
- UUID v7 contains the creation time, so an ID slightly reveals when a row was created. This is accepted
  because the 404 rule and the tenant filter stay the main defence, not the secrecy of the ID.
- The schema is not complete without the migration. CHECK constraints and the partial index are not visible
  in `schema.prisma`. On Prisma 7.10.1 a drift check (a new migration generated after a dummy column was
  added) did not drop them, and it should be repeated after a major upgrade.
- A new enum value needs a migration with `ALTER TYPE`. An enum value cannot be removed or reordered
  without recreating the type.
- Database errors for these rules (for example a duplicate Owner) must be mapped to API errors in the
  service layer, using the constraint names.
- The project cannot run on PostgreSQL older than 18 because `uuidv7()` does not exist there.
- Revisit the partial index once `partialIndexes` is stable and the documentation agrees.

## Sources

Opened on 24 Oct 2026: PostgreSQL 18 docs (UUID functions, check constraints, partial indexes,
date/time types) and the Prisma ORM 7 docs (database mapping, referential actions, customizing
migrations, indexes). The links are listed in `notes/walkthroughs/E0-04.md`, section E.
