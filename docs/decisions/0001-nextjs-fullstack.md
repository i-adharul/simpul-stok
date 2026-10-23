# ADR 0001: Next.js as a single fullstack codebase

- Status: accepted
- Date: 2026-10-23

## Context

Simpul Stok needs a web UI and a REST API for inventory, tenant isolation and billing.
It is built and run by one person, so fewer moving parts matter. The stack should also be
common in job listings and easy to explain.

## Decision

Use Next.js (App Router) as one fullstack codebase. The API is exposed through Route Handlers
(REST). Pages use Server Components, and tables with filters and mutations use TanStack Query
against the REST API. Server Actions are not used.

## Alternatives considered

- **Separate Express API plus a React app:** two deployments, CORS configuration, and types
  shared by hand.
- **NestJS:** good structure, but adds a learning curve that does not prove anything extra here.
- **Vite + React SPA:** still needs a separate backend.
- **Server Actions instead of REST:** REST is better known, can be tested with `curl` or `.http`
  files, and is clearer on a CV.

## Consequences

- One deployment (Vercel), no CORS, and UI and API share TypeScript types.
- Business rules must live in services that do not depend on HTTP or React, otherwise the
  single codebase turns into a tangle. See ADR 0002 for module boundaries.
- Route Handlers run as serverless functions, so there are no long-lived background workers.
  Scheduled work uses Vercel Cron, and access status is computed per request rather than only
  by the cron job.
- Next.js changes quickly. Check the bundled docs for the installed version before using an API
  from memory.
- Redis is not used: idempotency is guaranteed by a unique key in the database, and the demo
  scale does not need a cache. Revisit if traffic grows (rate limiting, caching, queues).
