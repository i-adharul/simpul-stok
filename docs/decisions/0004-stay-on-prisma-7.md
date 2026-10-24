# ADR 0004: Stay on Prisma ORM 7 and postpone Prisma ORM 8

- Status: accepted
- Date: 2026-10-24

## Context

Per the [Prisma release status page](https://www.prisma.io/docs/orm/release-status) (opened on 24 Oct 2026),
`npm install prisma` and `npx prisma` without a version now give the Prisma ORM 8 command-line tool. Prisma ORM 8
is a release candidate: "some details of the API may still change". Its command-line tool does not read
`schema.prisma` and has no `generate`, `migrate dev` or `db push` commands, and `@prisma/client` stays at
7.10.1 because it belongs to Prisma ORM 7.

This project depends on two Prisma features:

- `$extends`, for the tenant-scoped client that adds the `organizationId` filter (CLAUDE.md rule 3).
- Atomic updates for stock: conditional decrement with `updateMany` and `quantity >= amount` inside one
  `prisma.$transaction` (rule 6).

The same page lists what is not available in Prisma ORM 8 yet: `$extends`, filtering inside JSON columns, atomic
`increment`, most nested writes, transaction isolation levels, and the `P2002`-style error codes. It also says
general availability is expected in October 2026.

## Decision

Stay on Prisma ORM 7 and postpone Prisma ORM 8. The main reason: the tenant-scoped client needs `$extends`, and
stock changes need atomic updates, and neither is available in ORM 8 yet.

- `prisma`, `@prisma/client` and `@prisma/adapter-pg` use the range `^7.10.1`. The installed version is 7.10.1.
- The CLI is always called through `pnpm prisma` or a package script, never through `npx prisma` or `pnpm dlx
prisma` without a version. If a one-off call is needed, it is `npx prisma@7`.
- Upgrading to Prisma ORM 8 is a separate story with its own ADR.

## Alternatives considered

- **Move to Prisma ORM 8 now:** a release candidate whose API can still change, with the features this project
  needs missing. The tenant isolation and stock rules would have to be rebuilt on something else.
- **No version range (`latest`):** a fresh install would pull the ORM 8 command-line tool, which cannot read our
  schema or run our migrations.
- **Pin exact versions without `^`:** it would also block bug and security fixes in 7.x. The lockfile already
  pins what is installed, and CI installs with `--frozen-lockfile`.

## Consequences

- Prisma ORM 7 keeps receiving bug fixes and security updates for 18 months after the final release of Prisma
  ORM 8, so there is no pressure to move early.
- Review this decision when Prisma ORM 8 reaches its final release (the page says it is expected in October 2026)
  and the features above are available. The review is a new story and a new ADR that replaces this one, and it
  must run the concurrency tests and the tenant isolation tests on ORM 8 first.
- Documentation must be read for the 7.x version. Some pages show the ORM 8 contract style or the
  `prisma7.config.ts` name; this repository uses `schema.prisma` and `prisma.config.ts`.
- CLAUDE.md records the rule: the project uses Prisma ORM 7, and a move to 8 needs its own story and ADR.
