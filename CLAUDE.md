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
- PostgreSQL (Neon in production, Docker locally), Prisma, Zod
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
  lib/                 Shared utilities (env validation, formatting, logging)
  modules/
    platform/          Auth, organizations, members, plans, billing, platform admin
    stock/             Warehouses, products, stock levels, movements, transfers
docs/
  decisions/           Architecture decision records (ADRs)
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
5. Every stock change runs inside one `prisma.$transaction`. Decrements use a conditional
   atomic update (`updateMany` with `quantity >= amount`). Multi-row updates are ordered by
   `(warehouseId, productId)` to avoid deadlocks. The database `CHECK (quantity >= 0)` is the last safety net.
6. Mutations that can be retried carry an `Idempotency-Key`, enforced by a unique constraint.
7. Stock movement rows are immutable. Business data is archived, not deleted.
8. Secrets live only in environment variables. Never commit `.env*` except `.env.example`.
9. Error responses use `{ code, message, details }` and never include stack traces.
10. Do not add a library without a stated reason. Prefer what is already in the stack.
11. Language: code, comments, commit messages, issues and docs in English. UI text in Indonesian.
12. Dates are stored in UTC and shown in WIB. Numbers use Indonesian formatting in the UI.

## Commands

```bash
pnpm dev            # start the dev server
pnpm build          # production build (includes the TypeScript check)
pnpm lint           # ESLint
pnpm format         # Prettier, write
pnpm format:check   # Prettier, check only
```

Added by later stories (update this list when they land):

```bash
docker compose up -d              # local Postgres (E0-02)
pnpm test                         # Vitest (E0-03)
pnpm prisma migrate dev           # database migrations (E0-04)
pnpm prisma db seed               # demo data (E0-07)
```

Before finishing any task: `pnpm lint`, `pnpm build` and the tests must pass.

## Workflow

- One story = one GitHub issue = one branch = one pull request (squash merge).
- Branch: `e0-01-init-repo`. Commit: `E0-01: add strict tsconfig and ESLint config`.
  PR body includes `Closes #<issue number>`.
- Keep stories small (about 2 hours). Commit in small steps with clear messages.
- Tests first for business rules, then the implementation.

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
