# CLAUDE.md

@AGENTS.md

Guidance for AI assistants working in this repository. Keep this file short and current.
If the code and this file disagree, tell the maintainer instead of silently picking one.

## Project

Simpul Stok is the stock module of Simpul, a planned multi-branch operations platform.
It is a multi-warehouse, multi-tenant inventory SaaS built as a portfolio project.
What it must demonstrate: concurrency control (no negative stock), atomic transfers,
idempotent requests, tenant isolation, and a subscription/payment flow (Xendit sandbox).

Product and technical documents live in `docs/`. Decisions live in `docs/decisions/`.
Other Simpul modules (HR, point of sale) are ideas only. Do not build or scaffold them.

## Stack

- Next.js (App Router), one fullstack codebase. API through Route Handlers (REST).
  Server Actions are not used.
- TypeScript with `strict: true`
- PostgreSQL 18 (Neon in production, Docker locally), Prisma, Zod
- Tailwind CSS + shadcn/ui, React Hook Form, TanStack Query
- Auth: own session cookie (`httpOnly`, signed with `jose`), passwords hashed with `bcryptjs` (cost 12)
- Tests: Vitest against a real Postgres, Playwright for a few end-to-end flows
- Tooling: pnpm, ESLint, Prettier, GitHub Actions, Vercel
- Not used in this version: Redis, email delivery, rate limiting

Next.js here is a recent major version. Follow `AGENTS.md` and read the bundled docs in
`node_modules/next/dist/docs/` before using a Next.js API from memory.

## Structure

```
src/
  app/                 Next.js routes, layouts and Route Handlers
  lib/                 Shared utilities
    env-schema.ts      Zod schema and parseEnv() (pure, easy to test)
    env.ts             Validated `env` object (parses process.env once)
    env-schema.test.ts Unit tests live next to the code they test (`*.test.ts`)
  instrumentation.ts   Runs at server start; imports lib/env so bad config stops the app
  modules/
    platform/          Auth, organizations, members, plans, billing, platform admin
    stock/             Warehouses, products, stock levels, movements, transfers
docker/
  postgres-init/       SQL that runs when the local database volume is first created
docs/
  decisions/           Architecture decision records (ADRs)
docker-compose.yml     Local Postgres (databases: simpul_dev and simpul_test)
.env.example           Every environment variable the app reads, without secrets
vitest.config.mts      Test runner configuration
.github/workflows/     CI: format check, lint, typecheck, tests and build on every pull request
```

Dependency rule: `modules/stock` may import from `modules/platform`, never the other way
around. See `docs/decisions/0002-module-boundaries.md`.

Layering inside a module: route handler or page, then service, then tenant-scoped data
access. Only the last layer talks to Prisma.

- **Request context** is built from the session: `{ userId, organizationId, role, warehouseIds }`.
  Lower layers only receive this context.
- **Services** hold business rules and know nothing about HTTP or React.
- **Tenant-scoped data access** is a Prisma client extension that adds the `organizationId`
  filter automatically.

## Rules

1. `organizationId` comes only from the session. Never read it from a request body, query or URL.
2. A resource ID that belongs to another organization returns **404**, never 403.
3. Every query on tenant data goes through the tenant-scoped client. No raw `prisma.<model>` calls
   in services or route handlers.
4. Validate all input with Zod on the server, not only in forms.
5. Read configuration only through `env` from `src/lib/env.ts`, never `process.env` directly.
   A new variable goes into `env-schema.ts` and `.env.example` in the same change.
6. Every stock change runs inside one `prisma.$transaction`. Decrements use a conditional
   atomic update (`updateMany` with `quantity >= amount`). Multi-row updates are ordered by
   `(warehouseId, productId)` to avoid deadlocks. The database `CHECK (quantity >= 0)` is the last safety net.
7. Mutations that can be retried carry an `Idempotency-Key`, enforced by a unique constraint.
8. Stock movement rows are immutable. Business data is archived, not deleted.
9. Secrets live only in environment variables. Never commit `.env*` except `.env.example`.
10. Error responses use `{ code, message, details }` and never include stack traces.
11. Do not add a library without a stated reason. Prefer what is already in the stack.
12. Language: code, comments, commit messages, issues and docs in English. UI text in Indonesian.
13. Dates are stored in UTC and shown in WIB. Numbers use Indonesian formatting in the UI.

## Commands

```bash
cp .env.example .env    # first time only
docker compose up -d    # local Postgres (dev and test databases)
pnpm dev                # start the dev server
pnpm build              # production build (includes the TypeScript check)
pnpm lint               # ESLint
pnpm typecheck          # generate Next.js route types, then check TypeScript
pnpm test               # run all tests once (Vitest)
pnpm test:watch         # re-run tests on change while developing
pnpm format             # Prettier, write
pnpm format:check       # Prettier, check only
```

Added by later stories (update this list when they land):

```bash
pnpm prisma migrate dev           # database migrations (E0-04)
pnpm prisma db seed               # demo data (E0-07)
```

To rebuild the local database from scratch (this deletes local data): `docker compose down -v`,
then `docker compose up -d`.

Before finishing any task: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and
`pnpm build` must pass. CI runs the same checks on every pull request.

## Workflow

- One story = one GitHub issue = one branch = one pull request (squash merge).
- Branch: `e0-01-init-repo`. Commit: `E0-01: add strict tsconfig and ESLint config`.
  PR body includes `Closes #<issue number>`.
- Keep stories small (about 2 hours). Commit in small steps with clear messages.
- Tests first for business rules, then the implementation.
- Tests that need a database use the `TEST_DATABASE_URL` database, never the development one.

## How to assist

The maintainer must be able to explain every file without looking at the screen.

- Before writing code, explain the approach and the alternatives briefly. Wait for agreement.
- Write the test first when the task has a business rule, then the implementation.
- Do not write these in full; explain the design and let the maintainer type them:
  login and sessions, the tenant-scoped data access helper, stock mutation functions and their
  concurrency tests, webhook verification and idempotency.
- Forms, tables, styling, seed data and documentation may be written in full.
- Do not trust remembered library versions or APIs. Check the official docs, especially for
  Next.js, Prisma and Xendit.
- When reviewing code, look for tenant leaks, race conditions and unhandled errors.
