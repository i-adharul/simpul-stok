# ADR 0007: Neon and Vercel connection strategy (pooled for the app, direct and manual for migrations)

- Status: accepted
- Date: 2026-10-25

## Context

Story E0-08 puts the skeleton online: the app on Vercel (Hobby), the database on Neon (Free). Facts
that shaped the decision (checked on 2026-10-25 in the official documentation):

- Neon offers two connection strings per branch. The pooled one has `-pooler` in the host and goes
  through PgBouncer in transaction mode. The direct one does not. Neon lists schema migrations under
  direct connections, because migration tools may not work with transaction pooling
  (neon.com/docs/connect/connection-pooling).
- Vercel runs the app as many short-lived function instances, each opening its own connections. The
  pooler absorbs that; direct connections would exhaust Neon's connection limit.
- The acceptance criteria of E0-08 forbid running migrations on every build.
- Neon Free: compute scales to zero after 5 minutes without queries and this cannot be disabled; waking
  takes "a few hundred milliseconds" (neon.com/docs/connect/connection-latency). The quota is 100
  CU-hours per project per month (neon.com/docs/introduction/plans). A 0.25 CU compute that never sleeps
  uses about 180 CU-hours a month (0.25 x 720), more than the whole quota.
- Neon requires TLS on every connection and recommends `sslmode=verify-full`
  (neon.com/docs/connect/connect-securely).

## Decision

- **The app uses the pooled connection string** (`DATABASE_URL` in Vercel). `src/lib/db.ts` keeps a very
  small pool per instance (`max: 2`), caches the client on `globalThis`, and uses a 10 second connection
  timeout so a waking compute does not fail the first request.
- **Migrations use the direct connection string and are run by hand from the maintainer's laptop**,
  with `DATABASE_URL='...' pnpm prisma migrate deploy` in front of one command. They are not run by the
  Vercel build and not by CI.
- **Preview deployments use a separate Neon branch** (`preview`), with its own pooled string in the
  Vercel Preview scope. The migration command is run against **both** branches after every merge that
  adds a migration.
- **Seed is never run against Neon.** `assertSeedTarget` refuses a non-local database.
- **`GET /api/health` caches its database check in memory for 60 seconds per instance.** Without it, an
  uptime monitor or a bot would keep the Neon compute awake and spend the free quota. A failed check is
  cached for the same time. Rate limiting in general stays out of scope for this version.
- **SSL: the Neon connection string is kept exactly as given** (`sslmode=require&channel_binding=require`).
  No code removes parameters or weakens TLS, and `uselibpqcompat=true` is not added because it would
  weaken verification. What actually protects the runtime connection: `pg-connection-string` 2.14.1 treats
  `sslmode=require` as `verify-full` (certificate and host name are verified; it prints a one-time
  `SECURITY WARNING` about this alias, which is accepted). The `channel_binding=require` parameter is
  **not enforced by `pg` at runtime**: `pg` only offers channel binding through the `enableChannelBinding`
  option, which is deliberately not set. Prisma Migrate uses a different driver and works with the
  parameter, which was proven by applying the three migrations to both branches.

## Alternatives considered

- **Run migrations in the Vercel build.** Rejected: forbidden by the acceptance criteria, makes every
  preview build change a database, and a failing migration blocks deploys.
- **A GitHub Actions workflow that runs `migrate deploy`.** Rejected: it would store the production
  database credential in GitHub, widening who and what can reach it, while manual runs are enough at this
  size and have already been proven.
- **Use the pooled string for migrations too.** Rejected: against Neon's guidance for migration tools.
- **Use the direct string for the app.** Rejected: many serverless instances would exhaust connections.
- **Set `enableChannelBinding: true` in `db.ts`.** Rejected for now: `pg` would only use it when offered,
  not require it, and it was not tested against the pooler.
- **Share one Neon branch between production and previews.** Rejected: a preview could change production
  data.

## Consequences

- Every pull request that adds a migration needs a manual step after merge, for two branches. Forgetting
  the `preview` branch breaks preview deployments; forgetting `production` breaks the live app. The README
  section "Production migrations" lists the command.
- The first request after 5 idle minutes is slower (cold start). Health uses an 8 second timeout and
  `db.ts` a 10 second connection timeout for this.
- Health can report a state up to 60 seconds old.
- Request logs with status and duration exist for API routes only (the proxy only assigns the request ID).
- Optional follow-up: when the Vercel variables are rewritten, replace `sslmode=require` with
  `sslmode=verify-full`, as the Neon documentation recommends, so the intent is explicit and the `pg`
  warning disappears. Automating migrations later needs a new ADR that supersedes this one.
