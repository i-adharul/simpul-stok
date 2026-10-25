import { NextResponse } from "next/server";
import type { PrismaClient } from "../../generated/prisma/client";
import { errorResponse } from "../../lib/api-error";
import { noStore } from "./auth-response";
import { loginSchema } from "./auth-schema";
import { login } from "./auth-service";
import { SESSION_COOKIE_NAME, createSessionToken, sessionCookieOptions } from "./session";

type Deps = { prisma: PrismaClient; secret: string };

// HTTP layer of POST /api/auth/login: parse, call the service, turn the result into a response.
// Business rules live in auth-service.ts. Dependencies are passed in so tests can use the test database.
export function createLoginHandler({ prisma, secret }: Deps) {
  return async function handleLogin(request: Request): Promise<Response> {
    const input = await parseBody(request);
    if (!input.success) {
      // No `details`: field-level hints are not needed here and must not describe the password rules.
      return noStore(errorResponse(400, "VALIDATION_ERROR", "Email dan password wajib diisi."));
    }

    const result = await login(prisma, input.data);
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

async function parseBody(request: Request) {
  try {
    return loginSchema.safeParse(await request.json());
  } catch {
    return loginSchema.safeParse(undefined); // body is not JSON: reported as a validation failure
  }
}
