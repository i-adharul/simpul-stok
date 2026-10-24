import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../../lib/env";
import type { PrismaClient } from "../../generated/prisma/client";
import { assertTestDatabaseUrl, createTestPrisma } from "../../test/test-database";
import { DEMO_ACCOUNTS, DEMO_ORGANIZATION, seedBase } from "./seed";

let prisma: PrismaClient;

beforeAll(() => {
  prisma = createTestPrisma(assertTestDatabaseUrl(env.TEST_DATABASE_URL));
});

beforeEach(async () => {
  assertTestDatabaseUrl(env.TEST_DATABASE_URL); // never truncate anything but a *_test database
  await prisma.$executeRaw`TRUNCATE TABLE subscriptions, users, plans, organizations RESTART IDENTITY CASCADE`;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("seedBase", () => {
  it("creates the Starter and Business plans with the documented prices and limits", async () => {
    await seedBase(prisma);
    const plans = await prisma.plan.findMany({ orderBy: { priceIdr: "asc" } });
    expect(
      plans.map((p) => [p.name, p.priceIdr, p.maxWarehouses, p.maxProducts, p.maxMembers]),
    ).toEqual([
      ["Starter", 300_000, 2, 100, 3],
      ["Business", 700_000, 10, 500, 10],
    ]);
  });

  it("creates one organization on a 30-day Starter trial", async () => {
    await seedBase(prisma);
    const org = await prisma.organization.findUniqueOrThrow({
      where: { slug: DEMO_ORGANIZATION.slug },
      include: { subscription: { include: { plan: true } } },
    });
    expect(org.status).toBe("TRIAL");
    const sub = org.subscription!;
    expect(sub.plan.name).toBe("Starter");
    expect(sub.billingDay).toBeNull();
    const day = 24 * 60 * 60 * 1000;
    expect(sub.currentPeriodEnd.getTime() - sub.currentPeriodStart.getTime()).toBe(30 * day);
    expect(sub.graceUntil.getTime() - sub.currentPeriodEnd.getTime()).toBe(3 * day);
  });

  it("creates one user per role; only the platform admin has no organization", async () => {
    await seedBase(prisma);
    const org = await prisma.organization.findUniqueOrThrow({
      where: { slug: DEMO_ORGANIZATION.slug },
    });
    const users = await prisma.user.findMany({ orderBy: { email: "asc" } });
    expect(users).toHaveLength(4);
    expect(users.map((u) => u.role).sort()).toEqual(
      ["OWNER", "PLATFORM_ADMIN", "VIEWER", "WAREHOUSE_ADMIN"].sort(),
    );
    for (const user of users) {
      expect(user.organizationId).toBe(user.role === "PLATFORM_ADMIN" ? null : org.id);
      expect(user.isActive).toBe(true);
    }
  });

  it("hashes every password with bcrypt cost 12", async () => {
    await seedBase(prisma);
    for (const account of DEMO_ACCOUNTS) {
      const user = await prisma.user.findUniqueOrThrow({ where: { email: account.email } });
      expect(user.passwordHash).toMatch(/^\$2[aby]\$12\$/);
      expect(user.passwordHash).not.toContain(account.password);
      expect(await bcrypt.compare(account.password, user.passwordHash)).toBe(true);
    }
  });

  it("uses demo passwords that follow the password rules", () => {
    const common = ["password123", "12345678", "password", "qwerty123"];
    for (const { email, password } of DEMO_ACCOUNTS) {
      expect(password.length).toBeGreaterThanOrEqual(8);
      expect(password.length).toBeLessThanOrEqual(72);
      expect(password).toMatch(/[A-Za-z]/);
      expect(password).toMatch(/\d/);
      expect(password.toLowerCase()).not.toBe(email);
      expect(password.toLowerCase()).not.toBe(email.split("@")[0]);
      expect(common).not.toContain(password.toLowerCase());
    }
    expect(new Set(DEMO_ACCOUNTS.map((a) => a.email)).size).toBe(DEMO_ACCOUNTS.length);
  });

  it("can run repeatedly: same rows, hashes untouched", async () => {
    await seedBase(prisma);
    const before = await prisma.user.findMany({ orderBy: { email: "asc" } });
    await seedBase(prisma);
    await seedBase(prisma);
    const after = await prisma.user.findMany({ orderBy: { email: "asc" } });
    expect(after).toEqual(before);
    expect(await prisma.plan.count()).toBe(2);
    expect(await prisma.organization.count()).toBe(1);
    expect(await prisma.subscription.count()).toBe(1);
  });

  it("restores plan limits that were changed by hand", async () => {
    await seedBase(prisma);
    await prisma.plan.update({ where: { name: "Starter" }, data: { maxProducts: 1 } });
    await seedBase(prisma);
    const starter = await prisma.plan.findUniqueOrThrow({ where: { name: "Starter" } });
    expect(starter.maxProducts).toBe(100);
  });
});
