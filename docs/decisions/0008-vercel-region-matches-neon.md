# ADR 0008: Vercel function region matches the Neon region

- Status: accepted
- Date: 2026-10-25

## Context

After the first deploy (story E0-08), `GET /api/health` took 1.9 to 2.4 seconds. The `x-vercel-id`
response header was `sin1::iad1::...`: the request entered at the Singapore edge, but the function ran in
`iad1` (Washington D.C., the Vercel default), while the Neon database is in Singapore. Every database
query crossed an ocean.

## Decision

The Vercel function region is **Singapore (`sin1`)**, the same as Neon. It is set in the Vercel dashboard
(Project Settings, Functions). After a redeploy the header became `sin1::sin1::...` and the health
latency fell to 962 ms (first call, including a Neon wake-up) and then 343 ms.

## Alternatives considered

- **Stay on `iad1`.** Rejected: an intercontinental round trip for every query.
- **Move Neon to US East.** Rejected: the users are in Indonesia, so the data would be far from them.
- **Multi-region functions.** Rejected: a Pro feature. Per the Vercel documentation, Hobby allows one
  function region per project.

## Consequences

- The setting lives in the Vercel dashboard, not in the repository, so a new Vercel project must repeat it.
- When `vercel.json` is created for the cron jobs (story E10-04), add `"regions": ["sin1"]` so the
  region is versioned with the code.
- ADR 0007 is unchanged; it covers the connection strategy, not the region.
