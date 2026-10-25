import bcrypt from "bcryptjs";
import type { PrismaClient, UserRole } from "../../generated/prisma/client";
import type { LoginInput } from "./auth-schema";

// A real bcrypt hash (cost 12) of a random string nobody knows. An unknown email is compared against
// it so that the request takes as long as one with a known email. It is a constant, not computed at
// import, so loading the module costs no ~300 ms hash.
export const DUMMY_PASSWORD_HASH = "$2b$12$FEsX5uDPKVMf1ineYDJyyeRHs1HCXtALe1jWR55eZkip4Wl4VhtTC";

const BCRYPT_MAX_BYTES = 72;

export type LoginUser = { id: string; name: string; email: string; role: UserRole };
export type LoginResult = { ok: true; user: LoginUser; redirectTo: string } | { ok: false };

// BL01. `{ ok: false }` is the only failure and carries no reason: unknown email, wrong password,
// inactive user and an over-long password must be indistinguishable to the caller.
//
// Uses the plain Prisma client on purpose (CLAUDE.md rule 3 exception): there is no session yet, so no
// organizationId to scope by, and the email is unique across all organizations. Every later query on
// tenant data must use the tenant-scoped client.
export async function login(prisma: PrismaClient, input: LoginInput): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  const passwordMatches = await comparePassword(input.password, user?.passwordHash);
  if (!user || !user.isActive || !passwordMatches) return { ok: false };

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return {
    ok: true,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    // Minimal on purpose: the SUSPENDED organization redirect (S21) arrives with E10-03.
    redirectTo: user.role === "PLATFORM_ADMIN" ? "/platform" : "/dashboard",
  };
}

// Always performs exactly one bcrypt comparison, whatever the input.
async function comparePassword(password: string, hash: string | undefined): Promise<boolean> {
  // bcrypt reads only the first 72 bytes. A longer password would match on its prefix, so it is
  // refused instead of silently truncated (decision on issue #24).
  const tooLong = new TextEncoder().encode(password).length > BCRYPT_MAX_BYTES;
  const matches = await bcrypt.compare(password, hash ?? DUMMY_PASSWORD_HASH);
  return hash !== undefined && !tooLong && matches;
}
