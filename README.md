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
cp .env.example .env    # then set SESSION_SECRET (see below): the placeholder is rejected on purpose
docker compose up -d    # Postgres on host port 5433 (5432 is often taken by a local install)
pnpm prisma migrate dev
pnpm prisma db seed
pnpm dev
```

## Session secret

`SESSION_SECRET` signs the login cookie (at least 32 characters). The app refuses to start with a shorter
value or with the placeholder from `.env.example`. Generate one per environment:

```bash
openssl rand -base64 48
```

- **Local:** put the value in `.env` (never commit it).
- **Vercel:** Project Settings, Environment Variables, add `SESSION_SECRET` for **Production** and **Preview**
  (a different value for each). A build or deploy without it fails at startup.
- **CI and tests** use a fixed non-secret stand-in (`.github/workflows/ci.yml`, `vitest.config.mts`).
- Changing the value signs everyone out. See [ADR 0009](docs/decisions/0009-stateless-signed-session.md).

## Production migrations

Migrations are never run by the Vercel build. The app connects to Neon through the **pooled**
connection string (host contains `-pooler`); migrations need the **direct** one (no `-pooler`).
Both are in the Neon Console under **Connect**. See [ADR 0007](docs/decisions/0007-neon-vercel-connection-strategy.md).

After a pull request that adds a migration is merged, run this from your laptop (zsh), once for **each**
Neon branch (`production` and `preview`):

```bash
read -s "NEON_DIRECT?Neon direct URL: "; echo
DATABASE_URL="$NEON_DIRECT" pnpm prisma migrate deploy
unset NEON_DIRECT
```

In bash, the first line is `read -s -p "Neon direct URL: " NEON_DIRECT; echo`.

- Use the hidden prompt. A command that contains the connection string is saved in your terminal history,
  so the credential would stay there. With `read -s` the string is typed without echo, lives only in a
  shell variable, and `unset` removes it. Do not write it to `.env`.
- `migrate deploy` only applies existing migrations. Never run `migrate dev` or `migrate reset` against Neon.
- Never run the seed against Neon. `pnpm prisma db seed` refuses a non-local database on purpose.
- Check the result with `pnpm prisma migrate status` (same prompt and `DATABASE_URL="$NEON_DIRECT"` prefix): it must say
  "Database schema is up to date".

## Roadmap

| Milestone | Scope                                                                          | Status                |
| --------- | ------------------------------------------------------------------------------ | --------------------- |
| M1        | Core inventory online: auth, warehouses, products, stock, transfers, dashboard | In progress (E5 next) |
| M2        | SaaS: organizations, plans, Xendit sandbox billing, platform admin             | Planned               |
| M3        | Extras: import/export, notifications, audit log, Row-Level Security            | Planned               |
| M4        | Portfolio polish: demo data, docs, security review                             | Planned               |

## Documentation

Product and technical documents are in [`docs/`](docs/).

## Known limitations

- Payments are sandbox only.
- No login rate limiting yet (deferred to later development).
- A single session cannot be revoked: sessions are signed cookies without a database table, and logging out only
  deletes the cookie. A user is cut off by deactivation or a password change, and every session ends after 8 hours
  ([ADR 0009](docs/decisions/0009-stateless-signed-session.md)).
- The Content-Security-Policy has no `script-src` yet: it needs a per-request nonce, planned for the M4
  security review.
- Every write request from a non-browser client (curl, REST clients) must send an `Origin` header equal to
  the server's own scheme and host, or the CSRF check answers 403. Example:
  `curl -X POST http://localhost:3000/api/auth/logout -H "Origin: http://localhost:3000"`
- Request logs (status, duration) cover API routes only; pages get a request ID but no log line.
- The free Neon database sleeps after 5 minutes without queries, so the first request after a pause is slower.
- No email delivery; invitations and password resets use links that are copied manually.

## How this project is built

This project is built with AI pair programming (Claude Code). The maintainer reviews every change and must be able to explain every part of it; the working rules are in [`CLAUDE.md`](CLAUDE.md) and the decisions and documents are in [`docs/`](docs/).
