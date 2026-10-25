import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  sessionCookieOptions,
  verifySessionToken,
} from "./session";

const secret = "test-only-session-secret-0123456789abcdef";
const otherSecret = "another-test-only-secret-0123456789abcdef";
const userId = "0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000";
const key = (value: string) => new TextEncoder().encode(value);

describe("session token", () => {
  it("round-trips the user id and the issue time", async () => {
    const now = new Date("2026-10-25T00:00:00Z");
    const token = await createSessionToken(userId, secret, now);
    const session = await verifySessionToken(token, secret, now);
    expect(session).toEqual({ userId, issuedAt: new Date("2026-10-25T00:00:00Z") });
  });

  it("lasts exactly 8 hours with no extension", async () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(8 * 60 * 60);
    const issued = new Date("2026-10-25T00:00:00Z");
    const token = await createSessionToken(userId, secret, issued);
    const justBefore = new Date(issued.getTime() + (SESSION_MAX_AGE_SECONDS - 1) * 1000);
    const atExpiry = new Date(issued.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
    expect(await verifySessionToken(token, secret, justBefore)).not.toBeNull();
    expect(await verifySessionToken(token, secret, atExpiry)).toBeNull();
  });

  it("rejects a token signed with another secret", async () => {
    const token = await createSessionToken(userId, otherSecret);
    expect(await verifySessionToken(token, secret)).toBeNull();
  });

  it("rejects a token whose payload was changed", async () => {
    const token = await createSessionToken(userId, secret);
    const [header, , signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "someone-else", exp: 9999999999 })).toString(
      "base64url",
    );
    expect(await verifySessionToken(`${header}.${forged}.${signature}`, secret)).toBeNull();
  });

  it("rejects an unsigned token (alg none)", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: userId, exp: 9999999999 })).toString(
      "base64url",
    );
    expect(await verifySessionToken(`${header}.${payload}.`, secret)).toBeNull();
  });

  it("rejects a token signed with another algorithm even with the right secret", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS512" })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime("8h")
      .sign(key(secret));
    expect(await verifySessionToken(token, secret)).toBeNull();
  });

  it("rejects a signed token without a subject", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("8h")
      .sign(key(secret));
    expect(await verifySessionToken(token, secret)).toBeNull();
  });

  it("rejects garbage without throwing", async () => {
    expect(await verifySessionToken("not-a-token", secret)).toBeNull();
    expect(await verifySessionToken("", secret)).toBeNull();
  });
});

describe("sessionCookieOptions", () => {
  it("uses the __Host- prefix and the flags the prefix requires", () => {
    expect(SESSION_COOKIE_NAME).toBe("__Host-simpul_session");
    const options = sessionCookieOptions();
    expect(options).toMatchObject({
      httpOnly: true,
      secure: true, // always: never depends on NODE_ENV
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    expect(options).not.toHaveProperty("domain"); // __Host- forbids a Domain attribute
  });
});
