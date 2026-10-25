import bcrypt from "bcryptjs";
import type { PrismaClient } from "../../generated/prisma/client";
import { comparePassword } from "./auth-service";
import type { ChangePasswordInput } from "./auth-schema";
import { validatePassword } from "./password";

const BCRYPT_COST = 12;

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; reason: "INVALID_CURRENT_PASSWORD" }
  | { ok: false; reason: "INVALID_NEW_PASSWORD"; message: string };

// BL01. Setting passwordChangedAt is what rejects every older session (see getCurrentUser).
// The user id comes from the verified session, never from the request body.
// Plain Prisma client on purpose (rule 3 exception): the row is addressed by the session's own
// user id, and the endpoint reads no other tenant data.
export async function changePassword(
  prisma: PrismaClient,
  userId: string,
  input: ChangePasswordInput,
  now: Date = new Date(),
): Promise<ChangePasswordResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, reason: "INVALID_CURRENT_PASSWORD" };

  if (!(await comparePassword(input.currentPassword, user.passwordHash))) {
    return { ok: false, reason: "INVALID_CURRENT_PASSWORD" };
  }
  const check = validatePassword(input.newPassword, user.email);
  if (!check.ok) return { ok: false, reason: "INVALID_NEW_PASSWORD", message: check.message };

  const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_COST);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, passwordChangedAt: now },
  });
  return { ok: true };
}
