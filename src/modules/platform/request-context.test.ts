import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api-error";
import { env } from "../../lib/env";
import type { PrismaClient } from "../../generated/prisma/client";
import { assertTestDatabaseUrl, createTestPrisma } from "../../test/test-database";
import { DEMO_ACCOUNTS, seedBase } from "./seed";
import { SESSION_COOKIE_NAME, createSessionToken } from "./session";
import { getRequestContext } from "./request-context";

const secret = env.SESSION_SECRET;
let prisma: PrismaClient;
let organizationId: string;
const warehouseIds: Record<string, string> = {};
const userIds: Record<string, string> = {};

const requestFor = (token?: string, url = "http://localhost/api/x") =>
  new Request(url, { headers: token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {} });

async function contextOf(role: string) {
  const token = await createSessionToken(userIds[role], secret);
  return getRequestContext(prisma, secret, requestFor(token));
}

async function statusOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return (error as ApiError).status;
}

beforeAll(async () => {
  prisma = createTestPrisma(assertTestDatabaseUrl(env.TEST_DATABASE_URL));
  await prisma.$executeRaw`TRUNCATE TABLE user_warehouses, warehouses, subscriptions, users, plans, organizations RESTART IDENTITY CASCADE`;
  await seedBase(prisma);
  organizationId = (await prisma.organization.findFirstOrThrow()).id;
  for (const a of DEMO_ACCOUNTS) {
    userIds[a.role] = (await prisma.user.findUniqueOrThrow({ where: { email: a.email } })).id;
  }
  const make = (code: string, archivedAt: Date | null = null) =>
    prisma.warehouse.create({ data: { organizationId, code, name: code, archivedAt } });
  warehouseIds.A = (await make("A")).id;
  warehouseIds.B = (await make("B")).id;
  warehouseIds.OLD = (await make("OLD", new Date())).id;
  // Another organization with its own warehouse: must never show up in any context.
  const other = await prisma.organization.create({ data: { name: "Other", slug: "other" } });
  await prisma.warehouse.create({
    data: { organizationId: other.id, code: "X", name: "X" },
  });
  // The warehouse admin is assigned to A and to the archived OLD one.
  for (const key of ["A", "OLD"]) {
    await prisma.userWarehouse.create({
      data: {
        userId: userIds.WAREHOUSE_ADMIN,
        warehouseId: warehouseIds[key],
        organizationId,
      },
    });
  }
  await prisma.userWarehouse.create({
    data: { userId: userIds.VIEWER, warehouseId: warehouseIds.B, organizationId },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("getRequestContext", () => {
  it("gives the owner every active warehouse of the organization", async () => {
    const context = await contextOf("OWNER");
    expect(context).toMatchObject({
      userId: userIds.OWNER,
      organizationId,
      role: "OWNER",
    });
    expect([...context.warehouseIds].sort()).toEqual([warehouseIds.A, warehouseIds.B].sort());
  });

  it("gives a warehouse admin only the assigned active warehouses", async () => {
    const context = await contextOf("WAREHOUSE_ADMIN");
    expect(context.role).toBe("WAREHOUSE_ADMIN");
    expect(context.warehouseIds).toEqual([warehouseIds.A]);
  });

  it("gives a viewer only the assigned warehouses", async () => {
    const context = await contextOf("VIEWER");
    expect(context.role).toBe("VIEWER");
    expect(context.warehouseIds).toEqual([warehouseIds.B]);
  });

  it("ignores an organizationId in the URL", async () => {
    const token = await createSessionToken(userIds.OWNER, secret);
    const context = await getRequestContext(
      prisma,
      secret,
      requestFor(
        token,
        "http://localhost/api/x?organizationId=00000000-0000-0000-0000-000000000000",
      ),
    );
    expect(context.organizationId).toBe(organizationId);
  });

  it("rejects a platform admin (no organization) with 403", async () => {
    expect(await statusOf(contextOf("PLATFORM_ADMIN"))).toBe(403);
  });

  it("rejects a missing or invalid session with 401", async () => {
    expect(await statusOf(getRequestContext(prisma, secret, requestFor()))).toBe(401);
    expect(await statusOf(getRequestContext(prisma, secret, requestFor("garbage")))).toBe(401);
  });
});
