import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { env } from "./env";

// Base client for NON-tenant queries only (health check, authentication). Tenant data must go
// through the tenant-scoped client (CLAUDE.md rule 3), built on top of this one in
// modules/platform/tenant-client.ts. Only the files in eslint.config.mjs may import this.
//
// Serverless: each Vercel instance keeps a tiny pool (max 2) so many instances do not exhaust
// Neon's pooler. The 10 s connection timeout covers a Neon compute waking from idle.
// SSL comes only from the connection string (sslmode / channel_binding are kept as Neon gives them).
function createClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: env.DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
    }),
  });
}

// Cached on globalThis so a dev hot reload or a reused instance does not open new connections.
const globalForDb = globalThis as unknown as { simpulDb?: PrismaClient };
export const db = (globalForDb.simpulDb ??= createClient());

export async function pingDatabase(): Promise<void> {
  await db.$queryRaw`SELECT 1`;
}
