# ADR 0005: Immutable stock movements enforced by a database trigger

- Status: accepted
- Date: 2026-10-24

## Context

`stock_movements` is the history of every stock change. CLAUDE.md rule 8 says movement rows are
immutable, and `docs/03_Data_Model.md` calls the table append-only. If a row can be edited or removed,
the balance in `stock_levels` can no longer be explained by its history, and the audit trail loses its
value. Story E0-05 creates the table, so this is the moment to decide who enforces the rule.

## Decision

A row-level trigger `stock_movements_immutable` (`BEFORE UPDATE OR DELETE`, `FOR EACH ROW`) calls
`stock_movements_reject_change()`, which raises `restrict_violation` with the message
`stock_movements are immutable`. It lives in the custom SQL of the `stock_schema` migration, and
`src/modules/stock/schema-constraints.test.ts` proves it for UPDATE, DELETE and for the TRUNCATE case.

`TRUNCATE` is not blocked. In PostgreSQL it is a separate statement-level event, and the tests use it
to clean up between cases. That is deliberate.

## Alternatives considered

- **Application rule only (no UPDATE or DELETE function exists):** costs nothing, but a seed script, a
  raw SQL test, a manual fix or a future bug can still change a row. The database is the last line, as
  with `CHECK (quantity >= 0)`.
- **`REVOKE UPDATE, DELETE` on the application role:** also strong, but it needs a separate database
  role per environment (Docker, CI, Neon) and migrations must run as another role. That adds setup that
  this project does not have yet. It also does not protect against the owner role.
- **Trigger that also blocks TRUNCATE:** would stop test cleanup, and tests would need a different
  way to reset data.

## Consequences

- Any code path that tries to change a movement gets an error, so a correction is always a new row
  (for example an ADJUST movement), never an edit.
- A superuser or the table owner can still disable the trigger (`ALTER TABLE ... DISABLE TRIGGER`) or
  truncate the table. This protects against mistakes, not against someone with full database rights.
- Services must map this error if it ever surfaces. It signals a bug, not a user mistake, so it
  should become a generic 500 and not a business error.
- Deleting an organization is already blocked by `ON DELETE RESTRICT`, so no cascade can hit the trigger.
- The trigger is not visible in `schema.prisma`. It lives only in `migration.sql`, like the other custom
  rules (ADR 0003).

## Sources

PostgreSQL 18 documentation, `CREATE TRIGGER`, opened on 24 Oct 2026: multiple events with `OR`,
and TRUNCATE only as a statement-level trigger.
