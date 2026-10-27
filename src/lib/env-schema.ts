import { z } from "zod";

const postgresUrl = z.string().refine((value) => /^postgres(ql)?:\/\//.test(value), {
  message: "must be a PostgreSQL connection string (postgresql://...)",
});

// The placeholder in .env.example. It is long enough to pass the length rule on purpose, and rejected
// by name, so `cp .env.example .env` cannot start an app that signs sessions with a public value.
export const SESSION_SECRET_EXAMPLE = "CHANGE-ME-example-value-not-a-real-secret";

// No custom message below may include the value: an invalid secret must not reach a log.
const sessionSecret = z
  .string()
  .min(32, {
    message: "must be at least 32 characters (generate one with `openssl rand -base64 48`)",
  })
  .refine((value) => value !== SESSION_SECRET_EXAMPLE, {
    message: "must not be the placeholder from .env.example",
  });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: postgresUrl,
  // Signs the session cookie (HS256). Rotating it logs everyone out.
  SESSION_SECRET: sessionSecret,
  // Only needed when running automated tests.
  TEST_DATABASE_URL: postgresUrl.optional(),
  // Only read by the seed (assertSeedTarget): lets it write demo accounts to a non-local database.
  SEED_ALLOW_REMOTE: z.string().optional(),
  // Only read by the demo seed (`pnpm seed:demo`): the password of the demo accounts on a REMOTE
  // database, where the committed local passwords must not be used. The seed checks the password rules.
  DEMO_PASSWORD: z.string().max(72).optional(),
  // Set by Vercel on deploys when "Automatically expose System Environment Variables" is on.
  // Only the first 7 characters are shown, by GET /api/health.
  VERCEL_GIT_COMMIT_SHA: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
