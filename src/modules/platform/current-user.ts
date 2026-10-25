import type { PrismaClient, UserRole } from "../../generated/prisma/client";
import { SESSION_COOKIE_NAME, verifySessionToken } from "./session";

export type CurrentUser = {
  user: { id: string; name: string; email: string; role: UserRole };
  organization: { id: string; name: string; slug: string; status: string } | null;
};

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

// BL01. The token only proves who and when; everything else is read from the database on every
// request, so deactivation and password changes take effect at once. Returns null for every
// failure so the caller cannot tell the client why.
//
// Plain Prisma client on purpose (rule 3 exception): the organization is derived from the user
// found by the session's user id, not supplied by the request.
export async function getCurrentUser(
  prisma: PrismaClient,
  secret: string,
  request: Request,
  now: Date = new Date(),
): Promise<CurrentUser | null> {
  const token = readCookie(request, SESSION_COOKIE_NAME);
  if (!token) return null;
  const session = await verifySessionToken(token, secret, now);
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { organization: true },
  });
  if (!user || !user.isActive) return null;

  // Compared in whole seconds: iat has second precision, passwordChangedAt has milliseconds.
  if (user.passwordChangedAt) {
    const changedAt = Math.floor(user.passwordChangedAt.getTime() / 1000);
    if (Math.floor(session.issuedAt.getTime() / 1000) < changedAt) return null;
  }

  const org = user.organization;
  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    organization: org ? { id: org.id, name: org.name, slug: org.slug, status: org.status } : null,
  };
}
