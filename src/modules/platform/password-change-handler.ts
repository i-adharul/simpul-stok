import { NextResponse } from "next/server";
import type { PrismaClient } from "../../generated/prisma/client";
import { errorResponse } from "../../lib/api-error";
import { noStore } from "./auth-response";
import { changePasswordSchema } from "./auth-schema";
import { getCurrentUser } from "./current-user";
import { changePassword } from "./password-change";
import { SESSION_COOKIE_NAME, createSessionToken, sessionCookieOptions } from "./session";

type Deps = { prisma: PrismaClient; secret: string };

// HTTP layer of PATCH /api/me/password. Any logged-in user may call it, in every subscription
// state (BL23): nothing here looks at the organization's status.
export function createChangePasswordHandler({ prisma, secret }: Deps) {
  return async function handleChangePassword(request: Request): Promise<Response> {
    const current = await getCurrentUser(prisma, secret, request);
    if (!current) {
      return noStore(
        errorResponse(401, "UNAUTHENTICATED", "Sesi tidak valid. Silakan masuk lagi."),
      );
    }

    const input = await parseBody(request);
    if (!input.success) {
      return noStore(
        errorResponse(400, "VALIDATION_ERROR", "Password saat ini dan password baru wajib diisi."),
      );
    }

    // One clock reading for both: the new token's iat must not be older than passwordChangedAt.
    const now = new Date();
    const result = await changePassword(prisma, current.user.id, input.data, now);
    if (!result.ok && result.reason === "INVALID_CURRENT_PASSWORD") {
      return noStore(errorResponse(400, "INVALID_CURRENT_PASSWORD", "Password saat ini salah."));
    }
    if (!result.ok) {
      return noStore(
        errorResponse(400, "VALIDATION_ERROR", result.message, { field: "newPassword" }),
      );
    }

    // Older sessions are now rejected, including this device's own. A fresh cookie keeps this
    // device logged in; every other device must log in again.
    const token = await createSessionToken(current.user.id, secret, now);
    const response = noStore(new NextResponse(null, { status: 204 }));
    (response as NextResponse).cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions());
    return response;
  };
}

async function parseBody(request: Request) {
  try {
    return changePasswordSchema.safeParse(await request.json());
  } catch {
    return changePasswordSchema.safeParse(undefined);
  }
}
