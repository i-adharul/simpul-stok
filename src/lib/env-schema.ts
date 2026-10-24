import { z } from "zod";

const postgresUrl = z.string().refine((value) => /^postgres(ql)?:\/\//.test(value), {
  message: "must be a PostgreSQL connection string (postgresql://...)",
});

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: postgresUrl,
  // Only needed when running automated tests.
  TEST_DATABASE_URL: postgresUrl.optional(),
  // Only read by the seed (assertSeedTarget): lets it write demo accounts to a non-local database.
  SEED_ALLOW_REMOTE: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
