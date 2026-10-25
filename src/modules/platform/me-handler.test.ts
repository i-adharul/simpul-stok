import { SignJWT } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../../lib/env";
import type { PrismaClient } from "../../generated/prisma/client";
import { assertTestDatabaseUrl, createTestPrisma } from "../../test/test-database";
import { createLogoutHandler, createMeHandler } from "./me-handler";
import { DEMO_ACCOUNTS, seedBase } from "./seed";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS, createSessionToken } from "./session";

const secret = env.SESSION_SECRET;
const owner = DEMO_ACCOUNTS.find((a) => a.role === "OWNER")!;
let prisma: PrismaClient;
let me: ReturnType<typeof createMeHandler>;
let ownerId: string;

const get = (token?: string) =>
  new Request("http://localhost/api/me", {
    headers: token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {},
  });

async function expectUnauthenticated(response: Response) {
  expect(response.status).toBe(401);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    code: "UNAUTHENTICATED",
    message: "Sesi tidak valid. Silakan masuk lagi.",
    details: null,
  });
}

beforeAll(async () => {
  prisma = createTestPrisma(assertTestDatabaseUrl(env.TEST_DATABASE_URL));
  await prisma.$executeRaw`TRUNCATE TABLE subscriptions, users, plans, organizations RESTART IDENTITY CASCADE`;
  await seedBase(prisma);
  me = createMeHandler({ prisma, secret });
  ownerId = (await prisma.user.findUniqueOrThrow({ where: { email: owner.email } })).id;
});

beforeEach(async () => {
  await prisma.user.updateMany({ data: { isActive: true, passwordChangedAt: null } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /api/me", () => {
  it("returns the user and organization for a valid session", async () => {
    const response = await me(get(await createSessionToken(ownerId, secret)));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.user).toEqual({ id: ownerId, name: owner.name, email: owner.email, role: "OWNER" });
    expect(body.organization).toEqual({
      id: expect.any(String),
      name: expect.any(String),
      slug: expect.any(String),
      status: expect.any(String),
    });
    expect(JSON.stringify(body)).not.toContain("passwordHash");
  });

  it("returns 401 without a cookie", async () => {
    await expectUnauthenticated(await me(get()));
  });

  it("returns 401 for an expired session", async () => {
    const old = new Date(Date.now() - (SESSION_MAX_AGE_SECONDS + 60) * 1000);
    await expectUnauthenticated(await me(get(await createSessionToken(ownerId, secret, old))));
  });

  it("returns 401 for a tampered token", async () => {
    const [h, , s] = (await createSessionToken(ownerId, secret)).split(".");
    const payload = Buffer.from(JSON.stringify({ sub: ownerId, exp: 9999999999 })).toString(
      "base64url",
    );
    await expectUnauthenticated(await me(get(`${h}.${payload}.${s}`)));
  });

  it("returns 401 for a session created before passwordChangedAt", async () => {
    const issued = new Date(Date.now() - 60_000);
    const token = await createSessionToken(ownerId, secret, issued);
    await prisma.user.update({ where: { id: ownerId }, data: { passwordChangedAt: new Date() } });
    await expectUnauthenticated(await me(get(token)));
  });

  it("accepts a session issued in the same second as passwordChangedAt", async () => {
    const now = new Date();
    const token = await createSessionToken(ownerId, secret, now);
    // Truncated to the second by the comparison: same second is not "before".
    await prisma.user.update({ where: { id: ownerId }, data: { passwordChangedAt: now } });
    expect((await me(get(token))).status).toBe(200);
  });

  it("rejects a session issued one second before passwordChangedAt", async () => {
    // Recent (so not expired), on a whole second, so the only difference is the second boundary.
    const issued = new Date(Math.floor(Date.now() / 1000) * 1000 - 5_000);
    const token = await createSessionToken(ownerId, secret, issued);
    await prisma.user.update({
      where: { id: ownerId },
      data: { passwordChangedAt: new Date(issued.getTime() + 1_000) },
    });
    await expectUnauthenticated(await me(get(token)));
  });

  it("returns 401 once the user became inactive", async () => {
    const token = await createSessionToken(ownerId, secret);
    expect((await me(get(token))).status).toBe(200);
    await prisma.user.update({ where: { id: ownerId }, data: { isActive: false } });
    await expectUnauthenticated(await me(get(token)));
  });

  it("returns 401 when the user no longer exists", async () => {
    const token = await createSessionToken("0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000", secret);
    await expectUnauthenticated(await me(get(token)));
  });

  it("returns 401 for a signed token without exp", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(ownerId)
      .setIssuedAt()
      .sign(new TextEncoder().encode(secret));
    await expectUnauthenticated(await me(get(token)));
  });
});

describe("POST /api/auth/logout", () => {
  it("still returns 204 without any session", async () => {
    const response = await createLogoutHandler()();
    expect(response.status).toBe(204);
  });

  it("clears the cookie and is not cacheable", async () => {
    const response = await createLogoutHandler()();
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(cookie).toMatch(/Max-Age=0/i);
    expect(cookie).toMatch(/;\s*Secure/i);
    expect(cookie).toMatch(/;\s*Path=\//i);
  });
});
