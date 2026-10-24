# Simpul Stok

Multi-warehouse, multi-tenant inventory SaaS. A portfolio project built to demonstrate
concurrency control, atomic transactions, idempotency, and tenant isolation.

Simpul Stok is the stock module of **Simpul**, a planned multi-branch operations platform.
Other modules (HR, point of sale) are ideas only and are not built or designed yet.

[![CI](https://github.com/i-adharul/simpul-stok/actions/workflows/ci.yml/badge.svg)](https://github.com/i-adharul/simpul-stok/actions/workflows/ci.yml)
![Status](https://img.shields.io/badge/status-in%20development-yellow)

**Live demo:** [simpul-stok.vercel.app](https://simpul-stok.vercel.app) (health: [`/api/health`](https://simpul-stok.vercel.app/api/health)) · **Roadmap:** [GitHub Project board](https://github.com/users/i-adharul/projects/1)

> **Note:** payments use the Xendit **sandbox** only. No real money is processed.

## The problem

Businesses with several branches need to know how much of each item is in each
warehouse, move stock between warehouses, and trace why a number changed.
This project is designed to prevent:

- wrong balances caused by duplicated requests or half-finished transfers
- negative stock when two people take the last item at the same time
- missing history of who changed what, when, and why
- one company seeing another company's data

This is a product hypothesis for a portfolio, not yet validated with real users.

## What this project demonstrates

| Capability                                | How it is proven                                                   | Status       |
| ----------------------------------------- | ------------------------------------------------------------------ | ------------ |
| No negative stock under concurrent access | Concurrency test: 20 simultaneous requests against a stock of 10   | Planned (M1) |
| Atomic transfers between warehouses       | Test that forces a failure mid-transfer and checks nothing changed | Planned (M1) |
| Idempotent requests                       | Unique idempotency key enforced in the database                    | Planned (M1) |
| Tenant isolation                          | Automated tests across every endpoint (404 for other tenants' IDs) | Planned (M1) |
| Subscription and payment flow             | Webhook verification, duplicate-event handling, access freeze      | Planned (M2) |

## Tech stack

Next.js (App Router) · TypeScript (strict) · PostgreSQL (Neon) · Prisma · Zod ·
Tailwind CSS + shadcn/ui · Vitest · Playwright · GitHub Actions · Vercel

The reasoning behind each choice is recorded in [`docs/decisions/`](docs/decisions/).

## Getting started

Requirements: Node.js (see `.nvmrc`), pnpm, Docker.

```bash
pnpm install
cp .env.example .env
docker compose up -d    # Postgres on host port 5433 (5432 is often taken by a local install)
pnpm prisma migrate dev
pnpm prisma db seed
pnpm dev
```

> Script names must match `package.json`. Adjust this block once E0-02 and E0-07 are done.

## Production migrations

Migrations are never run by the Vercel build. The app connects to Neon through the **pooled**
connection string (host contains `-pooler`); migrations need the **direct** one (no `-pooler`).
Both are in the Neon Console under **Connect**. See [ADR 0007](docs/decisions/0007-neon-vercel-connection-strategy.md).

After a pull request that adds a migration is merged, run this from your laptop, once for **each**
Neon branch (`production` and `preview`):

```bash
DATABASE_URL='postgresql://...direct-connection-string...' pnpm prisma migrate deploy
```

- Put the variable in front of the command, as above. Do not `export` it and do not write it to `.env`,
  so the production credential does not stay in your shell or in a file.
- `migrate deploy` only applies existing migrations. Never run `migrate dev` or `migrate reset` against Neon.
- Never run the seed against Neon. `pnpm prisma db seed` refuses a non-local database on purpose.
- Check the result with `pnpm prisma migrate status` (same `DATABASE_URL` prefix): it must say
  "Database schema is up to date".

## Roadmap

| Milestone | Scope                                                                          | Status                      |
| --------- | ------------------------------------------------------------------------------ | --------------------------- |
| M1        | Core inventory online: auth, warehouses, products, stock, transfers, dashboard | In progress (E0 Foundation) |
| M2        | SaaS: organizations, plans, Xendit sandbox billing, platform admin             | Planned                     |
| M3        | Extras: import/export, notifications, audit log, Row-Level Security            | Planned                     |
| M4        | Portfolio polish: demo data, docs, security review                             | Planned                     |

## Documentation

Product and technical documents are in [`docs/`](docs/).

## Known limitations

- Payments are sandbox only.
- No login rate limiting yet (deferred to later development).
- Request logs (status, duration) cover API routes only; pages get a request ID but no log line.
- The free Neon database sleeps after 5 minutes without queries, so the first request after a pause is slower.
- No email delivery; invitations and password resets use links that are copied manually.

## How this project is built

This project is built with AI pair programming (Claude Code). The maintainer reviews every change and must be able to explain every part of it; the working rules are in [`CLAUDE.md`](CLAUDE.md) and the decisions and documents are in [`docs/`](docs/).
