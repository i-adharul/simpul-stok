# ADR 0006: Tenant integrity enforced by the application, not composite foreign keys

- Status: accepted
- Date: 2026-10-24

## Context

Tables such as `stock_levels`, `stock_movements` and `user_warehouses` carry their own
`organization_id` and also point to a warehouse and a product. A plain foreign key on
`warehouse_id` only proves that the warehouse exists. It does not prove that the warehouse belongs to the
same organization as the row. A row that mixes two tenants is therefore possible at the database level.
The data model lists tenant isolation rules (`docs/03_Data_Model.md`), and all of them are enforced above
the database.

## Decision

Story E0-05 uses plain single-column foreign keys. Tenant consistency is the job of the application:

- every query goes through the tenant-scoped Prisma client, which adds the `organization_id` filter
  (CLAUDE.md rule 3);
- a resource ID of another organization returns 404 (rule 2), so a service looks a warehouse or product
  up through that client before it writes a row that points to it;
- cross-tenant tests (story E2-08) try to reach and to write other tenants' data;
- Postgres Row-Level Security (E13-11) is the planned second layer if time allows.

## Alternatives considered

- **Composite foreign keys `(organization_id, id)`:** the database would refuse a mixed row. It needs an
  extra unique index on every parent table (`warehouses`, `products`, `users`, `stock_transfers`), bigger
  indexes, and Prisma models the relations awkwardly. Every table would need it for the guarantee to be
  complete.
- **Row-Level Security now:** a strong second layer, but it needs a session variable set on every
  connection and works poorly with pooled connections and the Prisma adapter. It is a larger story of its
  own.
- **Triggers that compare `organization_id` across tables:** extra logic per table that is easy to forget
  and hard to read.

## Consequences

- A row that points to a warehouse or product of another tenant can technically be created by raw SQL or
  by an application bug. Nothing in the schema stops it.
- The guarantee depends on the tenant-scoped client and its tests. A raw `prisma.<model>` call in a
  service (forbidden by rule 3) would bypass it, so code review must keep checking this.
- Schema changes stay simple and queries use smaller indexes.
- Revisit this decision when RLS lands, or if a cross-tenant test finds a leak.
