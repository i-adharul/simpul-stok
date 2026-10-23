# ADR 0002: Module boundaries (platform and stock)

- Status: accepted
- Date: 2026-10-23

## Context

Simpul is a planned multi-branch operations platform. Only one module is built in this
project: Simpul Stok (inventory). The HR module (Simpul Tim) and the point-of-sale module
(Simpul POS) are ideas and are not designed.

Some parts of this application are not about inventory: authentication, organizations,
members, plans, subscriptions and billing. If another module is ever built, these parts
would be shared. Today they live in the same codebase as the stock code.

## Decision

Keep one repository (`simpul-stok`) and one Next.js application, and separate the code into
two folders:

- `src/modules/platform`: authentication and sessions, organizations, members and
  invitations, plans, subscriptions, billing, platform admin.
- `src/modules/stock`: warehouses, products, stock levels, stock movements, transfers.

Dependency rule: `stock` may import from `platform`; `platform` must never import from `stock`.

The split is at the code level only. There is one database and one Prisma schema.

## Alternatives considered

- **Monorepo named `simpul` with `apps/stok`:** adds workspace and build configuration for
  modules that do not exist yet.
- **A GitHub organization with one repository per module:** the same problem, with more overhead.
- **No separation (flat structure):** the cheapest now, but extracting shared platform code
  later would mean untangling imports across the whole codebase.

## Consequences

- Splitting into a real platform later is a mechanical move, not a rewrite. The repository can
  be renamed (GitHub redirects old URLs) and the code moved into `apps/stok` and `packages/platform`.
- A one-way dependency rule must be followed by hand. It can be enforced later with an ESLint
  `no-restricted-imports` rule if it starts to slip.
- The folders add a small amount of structure up front. Do not add more layers than these two.
- The tenant concern (`organizationId` on every business table, tenant-scoped data access) is
  part of the platform foundation, even though most tables belong to stock.
