import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../../lib/env";
import type { PrismaClient } from "../../generated/prisma/client";
import { assertTestDatabaseUrl, createTestPrisma } from "../../test/test-database";
import { createMeHandler } from "./me-handler";
import { createChangePasswordHandler } from "./password-change-handler";
import { DEMO_ACCOUNTS, seedBase } from "./seed";
import { SESSION_COOKIE_NAME, createSessionToken } from "./session";

const secret = env.SESSION_SECRET;
const owner = DEMO_ACCOUNTS.find((a) => a.role === "OWNER")!;
const NEW_PASSWORD = "kopi-senja-baru-77";
let prisma: PrismaClient;
let change: ReturnType<typeof createChangePasswordHandler>;
let me: ReturnType<typeof createMeHandler>;
let ownerId: string;
let ownerHash: string;

const patch = (body: unknown, token?: string, raw = false) =>
  new Request("http://localhost/api/me/password", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {}),
    },
    body: raw ? (body as string) : JSON.stringify(body),
  });
const getMe = (token: string) =>
  new Request("http://localhost/api/me", {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
  });
const valid = { currentPassword: owner.password, newPassword: NEW_PASSWORD };

beforeAll(async () => {
  prisma = createTestPrisma(assertTestDatabaseUrl(env.TEST_DATABASE_URL));
  await prisma.$executeRaw`TRUNCATE TABLE subscriptions, users, plans, organizations RESTART IDENTITY CASCADE`;
  await seedBase(prisma);
  change = createChangePasswordHandler({ prisma, secret });
  me = createMeHandler({ prisma, secret });
  const user = await prisma.user.findUniqueOrThrow({ where: { email: owner.email } });
  ownerId = user.id;
  ownerHash = user.passwordHash;
});

beforeEach(async () => {
  await prisma.user.update({
    where: { id: ownerId },
    data: { passwordHash: ownerHash, passwordChangedAt: null, isActive: true },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("PATCH /api/me/password", () => {
  it("changes the password, sets passwordChangedAt and returns 204 with a fresh cookie", async () => {
    const token = await createSessionToken(ownerId, secret, new Date(Date.now() - 60_000));
    const response = await change(patch(valid, token));
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const user = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
    expect(await bcrypt.compare(NEW_PASSWORD, user.passwordHash)).toBe(true);
    expect(user.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(user.passwordChangedAt).not.toBeNull();

    // The current device stays logged in through the cookie issued by this response.
    const setCookie = response.headers.get("set-cookie")!;
    const newToken = setCookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`))![1];
    expect((await me(getMe(newToken))).status).toBe(200);
  });

  it("rejects sessions created before the change", async () => {
    const other = await createSessionToken(ownerId, secret, new Date(Date.now() - 60_000));
    const current = await createSessionToken(ownerId, secret, new Date(Date.now() - 30_000));
    expect((await change(patch(valid, current))).status).toBe(204);
    expect((await me(getMe(other))).status).toBe(401);
    expect((await me(getMe(current))).status).toBe(401);
  });

  it("returns 400 INVALID_CURRENT_PASSWORD for a wrong current password and changes nothing", async () => {
    const token = await createSessionToken(ownerId, secret);
    const response = await change(patch({ ...valid, currentPassword: "salah-banget-1" }, token));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "INVALID_CURRENT_PASSWORD",
      details: null,
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
    expect(user.passwordHash).toBe(ownerHash);
    expect(user.passwordChangedAt).toBeNull();
  });

  it("applies the shared password rules to the new password", async () => {
    const token = await createSessionToken(ownerId, secret);
    for (const newPassword of ["short1", "onlyletters", "password123", owner.email]) {
      const response = await change(patch({ ...valid, newPassword }, token));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "VALIDATION_ERROR",
        details: { field: "newPassword" },
      });
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })).passwordHash).toBe(
      ownerHash,
    );
  });

  it("returns 400 VALIDATION_ERROR for a missing field or a body that is not JSON", async () => {
    const token = await createSessionToken(ownerId, secret);
    expect((await change(patch({ currentPassword: owner.password }, token))).status).toBe(400);
    const response = await change(patch("not json", token, true));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("VALIDATION_ERROR");
  });

  it("returns 401 UNAUTHENTICATED without a valid session", async () => {
    const response = await change(patch(valid));
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("UNAUTHENTICATED");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })).passwordHash).toBe(
      ownerHash,
    );
  });

  it("is not blocked by the organization's subscription state (BL23)", async () => {
    const org = await prisma.organization.findFirstOrThrow({
      where: { users: { some: { id: ownerId } } },
    });
    const original = org.status;
    await prisma.organization.update({ where: { id: org.id }, data: { status: "SUSPENDED" } });
    try {
      const token = await createSessionToken(ownerId, secret);
      expect((await change(patch(valid, token))).status).toBe(204);
    } finally {
      await prisma.organization.update({ where: { id: org.id }, data: { status: original } });
    }
  });
});
