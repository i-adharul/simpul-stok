import { jwtVerify, SignJWT } from "jose";

// "__Host-" makes the browser accept the cookie only if it is Secure, has Path=/ and no Domain, so a
// sibling subdomain cannot overwrite it. Design: docs/decisions/0009-stateless-signed-session.md.
export const SESSION_COOKIE_NAME = "__Host-simpul_session";
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60; // BL01: 8 hours, never extended
const ALGORITHM = "HS256";

export type Session = { userId: string; issuedAt: Date };

const toKey = (secret: string) => new TextEncoder().encode(secret);

// The token carries only who and when. Role, organization and status are read from the database on
// every request, so deactivating a user or changing a password takes effect at once (BL01, BL07).
export async function createSessionToken(
  userId: string,
  secret: string,
  now: Date = new Date(),
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(userId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + SESSION_MAX_AGE_SECONDS)
    .sign(toKey(secret));
}

// Returns null for every failure (bad signature, expired, wrong algorithm, no subject): the caller
// only needs to know "no valid session", and must not tell the client why.
export async function verifySessionToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): Promise<Session | null> {
  try {
    // Pinning the algorithm stops a token that names a different one from being accepted.
    const { payload } = await jwtVerify(token, toKey(secret), {
      algorithms: [ALGORITHM],
      currentDate: now,
      // A validly signed token without exp would never expire, so exp is mandatory.
      requiredClaims: ["sub", "iat", "exp"],
    });
    if (typeof payload.sub !== "string" || typeof payload.iat !== "number") return null;
    return { userId: payload.sub, issuedAt: new Date(payload.iat * 1000) };
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true, // JavaScript on the page cannot read the token
    secure: true, // required by the __Host- prefix; browsers treat localhost as secure
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

// Same attributes as the login cookie (the __Host- prefix demands them) with an immediate expiry.
export function clearedSessionCookieOptions() {
  return { ...sessionCookieOptions(), maxAge: 0 };
}
