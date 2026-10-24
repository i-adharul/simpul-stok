import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../../lib/env";
import type { PrismaClient } from "../../generated/prisma/client";
import { assertTestDatabaseUrl, createTestPrisma } from "../../test/test-database";

// These tests prove the rules Prisma cannot express, so they insert with raw SQL on purpose:
// the database must reject bad rows no matter which code path wrote them.

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

async function insertOrganization(slug = "acme") {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO organizations (name, slug) VALUES (${"Org " + slug}, ${slug}) RETURNING id::text`;
  return rows[0].id;
}

type UserInput = {
  organizationId: string | null;
  email?: string;
  role?: "PLATFORM_ADMIN" | "OWNER" | "WAREHOUSE_ADMIN" | "VIEWER";
  resetTokenHash?: string | null;
  resetExpiresAt?: Date | null;
};

async function insertUser(input: UserInput) {
  const { organizationId, email = "owner@acme.test", role = "OWNER" } = input;
  const { resetTokenHash = null, resetExpiresAt = null } = input;
  await prisma.$executeRaw`
    INSERT INTO users (organization_id, email, name, password_hash, role, reset_token_hash, reset_expires_at)
    VALUES (${organizationId}::uuid, ${email}, 'Test', 'hash', ${role}::user_role, ${resetTokenHash}, ${resetExpiresAt})`;
}

async function insertPlan(
  overrides: { name?: string; priceIdr?: number; maxWarehouses?: number } = {},
) {
  const { name = "Starter", priceIdr = 0, maxWarehouses = 2 } = overrides;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO plans (name, price_idr, max_warehouses, max_products, max_members)
    VALUES (${name}, ${priceIdr}, ${maxWarehouses}, 100, 3) RETURNING id::text`;
  return rows[0].id;
}

async function insertSubscription(input: {
  organizationId: string;
  planId: string;
  billingDay?: number | null;
  start?: Date;
  end?: Date;
  graceUntil?: Date;
}) {
  const { organizationId, planId, billingDay = null } = input;
  const { start = new Date("2026-10-01T00:00:00Z"), end = new Date("2026-10-31T00:00:00Z") } =
    input;
  const { graceUntil = new Date("2026-11-03T00:00:00Z") } = input;
  await prisma.$executeRaw`
    INSERT INTO subscriptions (organization_id, plan_id, billing_day, current_period_start, current_period_end, grace_until)
    VALUES (${organizationId}::uuid, ${planId}::uuid, ${billingDay}, ${start}, ${end}, ${graceUntil})`;
}

describe("organizations", () => {
  it("rejects a duplicate slug", async () => {
    await insertOrganization("acme");
    await expect(insertOrganization("acme")).rejects.toThrow(/organizations_slug_key|unique/i);
  });

  it.each(["ab", "a".repeat(31), "Acme", "acme-store", "acme store"])(
    "rejects the slug %j (must be 3 to 30 lowercase letters and digits)",
    async (slug) => {
      await expect(insertOrganization(slug)).rejects.toThrow(/organizations_slug_format_check/);
    },
  );

  it.each(["abc", "a".repeat(30), "toko123"])("accepts the slug %j", async (slug) => {
    await expect(insertOrganization(slug)).resolves.toBeTruthy();
  });

  it("defaults the status to TRIAL", async () => {
    const id = await insertOrganization();
    const rows = await prisma.$queryRaw<
      { status: string }[]
    >`SELECT status::text FROM organizations WHERE id = ${id}::uuid`;
    expect(rows[0].status).toBe("TRIAL");
  });
});

describe("users", () => {
  it("rejects a duplicate email", async () => {
    const orgId = await insertOrganization();
    await insertUser({ organizationId: orgId, email: "a@acme.test" });
    await expect(
      insertUser({ organizationId: orgId, email: "a@acme.test", role: "VIEWER" }),
    ).rejects.toThrow(/users_email_key|unique/i);
  });

  it("rejects an email that differs only in letter case (stored lowercase)", async () => {
    const orgId = await insertOrganization();
    await insertUser({ organizationId: orgId, email: "a@acme.test" });
    await expect(
      insertUser({ organizationId: orgId, email: "A@Acme.test", role: "VIEWER" }),
    ).rejects.toThrow(/users_email_lowercase_check/);
  });

  it("rejects a second OWNER in the same organization", async () => {
    const orgId = await insertOrganization();
    await insertUser({ organizationId: orgId, email: "one@acme.test" });
    await expect(insertUser({ organizationId: orgId, email: "two@acme.test" })).rejects.toThrow(
      /users_one_owner_per_org|unique/i,
    );
  });

  it("allows an OWNER in another organization and any number of other roles", async () => {
    const orgA = await insertOrganization("acme");
    const orgB = await insertOrganization("globex");
    await insertUser({ organizationId: orgA, email: "a@acme.test" });
    await insertUser({ organizationId: orgB, email: "b@globex.test" });
    await insertUser({ organizationId: orgA, email: "w1@acme.test", role: "WAREHOUSE_ADMIN" });
    await insertUser({ organizationId: orgA, email: "w2@acme.test", role: "WAREHOUSE_ADMIN" });
    await insertUser({ organizationId: orgA, email: "v@acme.test", role: "VIEWER" });
  });

  it("rejects a PLATFORM_ADMIN that belongs to an organization", async () => {
    const orgId = await insertOrganization();
    await expect(insertUser({ organizationId: orgId, role: "PLATFORM_ADMIN" })).rejects.toThrow(
      /users_role_organization_check/,
    );
  });

  it.each(["OWNER", "WAREHOUSE_ADMIN", "VIEWER"] as const)(
    "rejects a %s without an organization",
    async (role) => {
      await expect(insertUser({ organizationId: null, role })).rejects.toThrow(
        /users_role_organization_check/,
      );
    },
  );

  it("accepts a PLATFORM_ADMIN without an organization", async () => {
    await insertUser({ organizationId: null, role: "PLATFORM_ADMIN", email: "root@simpul.test" });
  });

  it("rejects a reset token without an expiry, and an expiry without a token", async () => {
    const orgId = await insertOrganization();
    await expect(insertUser({ organizationId: orgId, resetTokenHash: "abc" })).rejects.toThrow(
      /users_reset_pair_check/,
    );
    await expect(insertUser({ organizationId: orgId, resetExpiresAt: new Date() })).rejects.toThrow(
      /users_reset_pair_check/,
    );
  });

  it("accepts a reset token together with its expiry", async () => {
    const orgId = await insertOrganization();
    await insertUser({ organizationId: orgId, resetTokenHash: "abc", resetExpiresAt: new Date() });
  });

  it("refuses to delete an organization that still has users (onDelete Restrict)", async () => {
    const orgId = await insertOrganization();
    await insertUser({ organizationId: orgId });
    await expect(prisma.organization.delete({ where: { id: orgId } })).rejects.toThrow();
  });
});

describe("plans", () => {
  it("rejects a duplicate plan name", async () => {
    await insertPlan({ name: "Starter" });
    await expect(insertPlan({ name: "Starter" })).rejects.toThrow(/plans_name_key|unique/i);
  });

  it("rejects a negative price and non-positive limits", async () => {
    await expect(insertPlan({ name: "Bad1", priceIdr: -1 })).rejects.toThrow(
      /plans_positive_values_check/,
    );
    await expect(insertPlan({ name: "Bad2", maxWarehouses: 0 })).rejects.toThrow(
      /plans_positive_values_check/,
    );
  });
});

describe("subscriptions", () => {
  it("rejects a second subscription for the same organization", async () => {
    const orgId = await insertOrganization();
    const planId = await insertPlan();
    await insertSubscription({ organizationId: orgId, planId });
    await expect(insertSubscription({ organizationId: orgId, planId })).rejects.toThrow(
      /subscriptions_organization_id_key|unique/i,
    );
  });

  it.each([0, 32, -1])("rejects billingDay %i", async (billingDay) => {
    const orgId = await insertOrganization();
    const planId = await insertPlan();
    await expect(insertSubscription({ organizationId: orgId, planId, billingDay })).rejects.toThrow(
      /subscriptions_billing_day_check/,
    );
  });

  it.each([null, 1, 31])("accepts billingDay %s", async (billingDay) => {
    const orgId = await insertOrganization();
    const planId = await insertPlan();
    await insertSubscription({ organizationId: orgId, planId, billingDay });
  });

  it("rejects a period that ends before it starts, and a grace date before the period end", async () => {
    const orgId = await insertOrganization();
    const planId = await insertPlan();
    await expect(
      insertSubscription({
        organizationId: orgId,
        planId,
        start: new Date("2026-10-31T00:00:00Z"),
        end: new Date("2026-10-01T00:00:00Z"),
      }),
    ).rejects.toThrow(/subscriptions_period_check/);
    await expect(
      insertSubscription({
        organizationId: orgId,
        planId,
        graceUntil: new Date("2026-10-15T00:00:00Z"),
      }),
    ).rejects.toThrow(/subscriptions_period_check/);
  });

  it("refuses to delete an organization or a plan that has a subscription (onDelete Restrict)", async () => {
    const orgId = await insertOrganization();
    const planId = await insertPlan();
    await insertSubscription({ organizationId: orgId, planId });
    await expect(prisma.plan.delete({ where: { id: planId } })).rejects.toThrow();
    await expect(prisma.organization.delete({ where: { id: orgId } })).rejects.toThrow();
  });
});
