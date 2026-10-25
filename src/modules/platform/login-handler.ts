import { NextResponse } from "next/server";
import type { PrismaClient } from "../../generated/prisma/client";
import { errorResponse } from "../../lib/api-error";
import type { ApiInput } from "../../lib/api-handler";
import { noStore } from "./auth-response";
import { loginSchema } from "./auth-schema";
import { login } from "./auth-service";
import { SESSION_COOKIE_NAME, createSessionToken, sessionCookieOptions } from "./session";

type Deps = { prisma: PrismaClient; secret: string };

// Validation options for withApiLog. No `details`: field-level hints are not needed here and must
// not describe the password rules.
export const loginRoute = {
  body: loginSchema,
  invalidMessage: "Email dan password wajib diisi.",
  hideIssues: true,
} as const;

// HTTP layer of POST /api/auth/login: call the service, turn the result into a response. The body
// is already validated by withApiLog. Business rules live in auth-service.ts. Dependencies are
// passed in so tests can use the test database.
export function createLoginHandler({ prisma, secret }: Deps) {
  return async function handleLogin(
    _request: Request,
    { body }: ApiInput<typeof loginRoute>,
  ): Promise<Response> {
    const result = await login(prisma, body);
    if (!result.ok) {
      // One answer for unknown email, wrong password, inactive user and over-long password.
      return noStore(errorResponse(401, "INVALID_CREDENTIALS", "Email atau password salah."));
    }

    const token = await createSessionToken(result.user.id, secret);
    const response = NextResponse.json(
      { user: result.user, redirectTo: result.redirectTo },
      // The response sets a credential: it must never be stored by a cache.
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions());
    return response;
  };
}
