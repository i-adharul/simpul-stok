import type { PrismaClient } from "../../generated/prisma/client";
import { errorResponse } from "../../lib/api-error";
import { noStore } from "./auth-response";
import { getCurrentUser } from "./current-user";
import { SESSION_COOKIE_NAME, clearedSessionCookieOptions } from "./session";
import { NextResponse } from "next/server";

type Deps = { prisma: PrismaClient; secret: string };

export function createMeHandler({ prisma, secret }: Deps) {
  return async function handleMe(request: Request): Promise<Response> {
    const current = await getCurrentUser(prisma, secret, request);
    if (!current) {
      return noStore(
        errorResponse(401, "UNAUTHENTICATED", "Sesi tidak valid. Silakan masuk lagi."),
      );
    }
    return noStore(NextResponse.json(current));
  };
}

// Always succeeds, even without a valid session: logging out twice is harmless (BL23 keeps it
// allowed in every subscription state). The session is a stateless token, so clearing the cookie
// is all the server can do (ADR 0009).
export function createLogoutHandler() {
  return async function handleLogout(): Promise<Response> {
    const response = noStore(new NextResponse(null, { status: 204 }));
    (response as NextResponse).cookies.set(SESSION_COOKIE_NAME, "", clearedSessionCookieOptions());
    return response;
  };
}
