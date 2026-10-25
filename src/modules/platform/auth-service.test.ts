import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../lib/env";
import type { PrismaClient } from "../../generated/prisma/client";
import { assertTestDatabaseUrl, createTestPrisma } from "../../test/test-database";
import { DUMMY_PASSWORD_HASH, login } from "./auth-service";
import { DEMO_ACCOUNTS, seedBase } from "./seed";

const owner = DEMO_ACCOUNTS.find((a) => a.role === "OWNER")!;
const admin = DEMO_ACCOUNTS.find((a) => a.role === "PLATFORM_ADMIN")!;
const viewer = DEMO_ACCOUNTS.find((a) => a.role === "VIEWER")!;

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createTestPrisma(assertTestDatabaseUrl(env.TEST_DATABASE_URL));
  await prisma.$executeRaw`TRUNCATE TABLE subscriptions, users, plans, organizations RESTART IDENTITY CASCADE`;
  await seedBase(prisma);
});

beforeEach(async () => {
  await prisma.user.updateMany({ data: { isActive: true, lastLoginAt: null } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("login success", () => {
  it("returns the user and /dashboard for a tenant user", async () => {
    const result = await login(prisma, { email: owner.email, password: owner.password });
    expect(result).toMatchObject({
      ok: true,
      redirectTo: "/dashboard",
      user: { email: owner.email, name: owner.name, role: "OWNER" },
    });
  });

  it("redirects a platform admin to /platform", async () => {
    const result = await login(prisma, { email: admin.email, password: admin.password });
    expect(result).toMatchObject({ ok: true, redirectTo: "/platform" });
  });

  it("never returns the password hash", async () => {
    const result = await login(prisma, { email: owner.email, password: owner.password });
    expect(JSON.stringify(result)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it("compares the email in lowercase and ignores surrounding spaces", async () => {
    const result = await login(prisma, {
      email: `  ${owner.email.toUpperCase()} `,
      password: owner.password,
    });
    expect(result.ok).toBe(true);
  });

  it("sets lastLoginAt", async () => {
    const before = Date.now();
    await login(prisma, { email: owner.email, password: owner.password });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: owner.email } });
    expect(user.lastLoginAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });
});

describe("login failure", () => {
  it("fails on a wrong password and does not touch lastLoginAt", async () => {
    const result = await login(prisma, { email: owner.email, password: "wrong-password-1" });
    expect(result).toEqual({ ok: false });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: owner.email } });
    expect(user.lastLoginAt).toBeNull();
  });

  it("fails on an unknown email with the same result as a wrong password", async () => {
    const unknown = await login(prisma, { email: "nobody@example.com", password: "whatever-123" });
    const wrong = await login(prisma, { email: owner.email, password: "whatever-123" });
    expect(unknown).toEqual(wrong);
  });

  it("fails for an inactive user even with the right password, same result", async () => {
    await prisma.user.update({ where: { email: viewer.email }, data: { isActive: false } });
    const inactive = await login(prisma, { email: viewer.email, password: viewer.password });
    const wrong = await login(prisma, { email: viewer.email, password: "whatever-123" });
    expect(inactive).toEqual({ ok: false });
    expect(inactive).toEqual(wrong);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: viewer.email } });
    expect(user.lastLoginAt).toBeNull();
  });

  it("fails on a password over 72 bytes, even if its first 72 bytes are the real password", async () => {
    // bcrypt would ignore everything after byte 72; accepting this would hide a truncation.
    const longPassword = owner.password + "x".repeat(80);
    await prisma.user.update({
      where: { email: owner.email },
      data: { passwordHash: await bcrypt.hash(longPassword.slice(0, 72), 12) },
    });
    try {
      const result = await login(prisma, { email: owner.email, password: longPassword });
      expect(result).toEqual({ ok: false });
    } finally {
      await prisma.user.update({
        where: { email: owner.email },
        data: { passwordHash: await bcrypt.hash(owner.password, 12) },
      });
    }
  });

  it("still runs one bcrypt comparison for an unknown email (equal work, no timing leak)", async () => {
    const spy = vi.spyOn(bcrypt, "compare");
    try {
      await login(prisma, { email: "nobody@example.com", password: "whatever-123" });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][1]).toBe(DUMMY_PASSWORD_HASH);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("DUMMY_PASSWORD_HASH", () => {
  it("is a ready-made bcrypt hash with cost 12", () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/);
  });
});
