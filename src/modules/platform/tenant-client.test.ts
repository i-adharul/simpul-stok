import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import { ApiError } from "../../lib/api-error";
import { env } from "../../lib/env";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { assertTestDatabaseUrl, createTestPrisma } from "../../test/test-database";
import type { RequestContext } from "./request-context";
import {
  GLOBAL_READ_MODELS,
  DENIED_MODELS,
  TENANT_MODELS,
  createTenantClient,
  type TenantClient,
} from "./tenant-client";

// Two organizations, one test database. Every test runs through the tenant client of A and looks
// at what it can reach in B. The plain client (`prisma`) is used only to arrange and to check.

let prisma: PrismaClient;

type Org = {
  id: string;
  prefix: string;
  userId: string;
  warehouseIds: string[];
  productIds: string[];
  planId: string;
  subscriptionId: string;
};
let a: Org;
let b: Org;
let tenant: TenantClient;

const contextOf = (org: Org): RequestContext => ({
  userId: org.userId,
  organizationId: org.id,
  role: "OWNER",
  warehouseIds: org.warehouseIds,
});

// Loose shape so one loop can run the same operation on every model.
type Delegate = {
  count(): Promise<number>;
  findMany(): Promise<{ organizationId?: string | null }[]>;
};
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const delegateOf = (client: unknown, model: string) =>
  (client as Record<string, Delegate>)[lowerFirst(model)];

async function seedOrg(prefix: string, planId: string): Promise<Org> {
  const org = await prisma.organization.create({
    data: { name: `Org ${prefix}`, slug: `org${prefix.toLowerCase()}` },
  });
  const organizationId = org.id;
  const user = await prisma.user.create({
    data: {
      organizationId,
      email: `owner@${prefix.toLowerCase()}.test`,
      name: "Owner",
      passwordHash: "hash",
      role: "OWNER",
    },
  });
  const now = new Date("2026-10-01T00:00:00Z");
  const later = new Date("2026-11-01T00:00:00Z");
  const subscription = await prisma.subscription.create({
    data: {
      organizationId,
      planId,
      currentPeriodStart: now,
      currentPeriodEnd: later,
      graceUntil: later,
    },
  });
  const warehouseIds: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const w = await prisma.warehouse.create({
      data: { organizationId, code: `${prefix}-${i}`, name: `Gudang ${prefix}${i}` },
    });
    warehouseIds.push(w.id);
  }
  const productIds: string[] = [];
  for (let i = 1; i <= 2; i++) {
    const p = await prisma.product.create({
      data: {
        organizationId,
        sku: `${prefix}-SKU-${i}`,
        name: `Produk ${prefix}${i}`,
        unit: "pcs",
      },
    });
    productIds.push(p.id);
  }
  await prisma.stockLevel.create({
    data: { organizationId, warehouseId: warehouseIds[0], productId: productIds[0], quantity: 10 },
  });
  await prisma.userWarehouse.create({
    data: { organizationId, userId: user.id, warehouseId: warehouseIds[0] },
  });
  const transfer = await prisma.stockTransfer.create({
    data: {
      organizationId,
      code: "MT-0001",
      fromWarehouseId: warehouseIds[0],
      toWarehouseId: warehouseIds[1],
      createdById: user.id,
    },
  });
  await prisma.stockMovement.create({
    data: {
      organizationId,
      warehouseId: warehouseIds[0],
      productId: productIds[0],
      quantityDelta: 10,
      type: "RECEIVE",
      createdById: user.id,
    },
  });
  void transfer;
  await prisma.idempotencyKey.create({
    data: { organizationId, key: `key-${prefix}`, endpoint: "POST /x", resourceId: user.id },
  });
  await prisma.invitation.create({
    data: {
      organizationId,
      email: `new@${prefix.toLowerCase()}.test`,
      role: "VIEWER",
      tokenHash: `token-${prefix}`,
      expiresAt: later,
      createdById: user.id,
    },
  });
  await prisma.importJob.create({
    data: {
      organizationId,
      fileName: "x.csv",
      totalRows: 1,
      errorRows: 0,
      rows: [],
      createdById: user.id,
    },
  });
  await prisma.invoice.create({
    data: {
      organizationId,
      subscriptionId: subscription.id,
      planId,
      number: `INV-${prefix}-1`,
      amountIdr: 300_000,
      kind: "INITIAL",
      periodStart: now,
      periodEnd: later,
      externalId: `ext-${prefix}`,
      dueAt: later,
      expiresAt: later,
    },
  });
  await prisma.auditLog.create({
    data: { organizationId, actorId: user.id, action: "x", entityType: "x", entityId: "1" },
  });
  await prisma.notification.create({
    data: { organizationId, userId: user.id, type: "LOW_STOCK", message: "x" },
  });
  return {
    id: organizationId,
    prefix,
    userId: user.id,
    warehouseIds,
    productIds,
    planId,
    subscriptionId: subscription.id,
  };
}

beforeAll(async () => {
  prisma = createTestPrisma(assertTestDatabaseUrl(env.TEST_DATABASE_URL));
});

beforeEach(async () => {
  assertTestDatabaseUrl(env.TEST_DATABASE_URL); // never truncate anything but a *_test database
  await prisma.$executeRaw`TRUNCATE TABLE webhook_events, notifications, audit_logs, invoices,
    import_jobs, invitations, idempotency_keys, stock_movements, stock_transfers, stock_levels,
    user_warehouses, products, warehouses, subscriptions, users, plans, organizations
    RESTART IDENTITY CASCADE`;
  const plan = await prisma.plan.create({
    data: { name: "Starter", priceIdr: 300_000, maxWarehouses: 2, maxProducts: 100, maxMembers: 3 },
  });
  a = await seedOrg("A", plan.id);
  b = await seedOrg("B", plan.id);
  tenant = createTenantClient(prisma, contextOf(a));
});

afterAll(async () => {
  await prisma.$disconnect();
});

// A rejected promise, as a value, so a test can look at the error.
async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected the call to reject, but it resolved");
    },
    (error: unknown) => error,
  );
}

const whereOf = (org: Org) => ({ organizationId: org.id });

describe("model coverage", () => {
  const scalarFields = (model: string) =>
    Object.keys(
      (Prisma as unknown as Record<string, Record<string, string>>)[`${model}ScalarFieldEnum`],
    );
  const withOrganizationId = Object.values(Prisma.ModelName).filter((model) =>
    scalarFields(model).includes("organizationId"),
  );

  it("lists in TENANT_MODELS every model that has an organizationId field", () => {
    const message =
      `Models with organizationId (derived from Prisma): ${withOrganizationId.join(", ")}.\n` +
      `TENANT_MODELS in tenant-client.ts: ${TENANT_MODELS.join(", ")}.\n` +
      `Add a new model to TENANT_MODELS so the tenant client scopes it.`;
    expect([...TENANT_MODELS].sort(), message).toEqual([...withOrganizationId].sort());
  });

  it("classifies every model exactly once", () => {
    const classified = [
      ...TENANT_MODELS,
      "Organization",
      ...GLOBAL_READ_MODELS,
      ...DENIED_MODELS,
    ].sort();
    expect(classified).toEqual(Object.values(Prisma.ModelName).sort());
  });

  it("keeps the global models free of organizationId", () => {
    for (const model of [...GLOBAL_READ_MODELS, ...DENIED_MODELS]) {
      expect(scalarFields(model)).not.toContain("organizationId");
    }
  });

  it.each([...TENANT_MODELS])(
    "%s: count and findMany see only the organization's rows",
    async (model) => {
      const expected = await delegateOf(prisma, model).findMany();
      const own = expected.filter((row) => row.organizationId === a.id).length;
      expect(own).toBeGreaterThan(0); // the fixture has rows in both organizations
      expect(expected.length).toBeGreaterThan(own);

      const rows = await delegateOf(tenant, model).findMany();
      expect(rows).toHaveLength(own);
      expect(rows.every((row) => row.organizationId === a.id)).toBe(true);
      expect(await delegateOf(tenant, model).count()).toBe(own);
    },
  );
});

describe("reads", () => {
  it("findMany ignores an OR that tries to reach another organization", async () => {
    const rows = await tenant.warehouse.findMany({
      where: { OR: [{ organizationId: b.id }, { code: "A-1" }] },
    });
    expect(rows.map((r) => r.code)).toEqual(["A-1"]);
  });

  it("findMany rejects a different organizationId in where", async () => {
    await expect(tenant.warehouse.findMany({ where: whereOf(b) })).rejects.toThrow(
      /organizationId/,
    );
  });

  it("findMany accepts the same organizationId in where", async () => {
    expect(await tenant.warehouse.findMany({ where: whereOf(a) })).toHaveLength(5);
  });

  it("findFirst returns null for a row of another organization", async () => {
    expect(await tenant.warehouse.findFirst({ where: { id: b.warehouseIds[0] } })).toBeNull();
    expect(await tenant.warehouse.findFirst({ where: { id: a.warehouseIds[0] } })).not.toBeNull();
  });

  it("findUnique returns null for an ID of another organization", async () => {
    expect(await tenant.warehouse.findUnique({ where: { id: b.warehouseIds[0] } })).toBeNull();
    expect(await tenant.warehouse.findUnique({ where: { id: a.warehouseIds[0] } })).not.toBeNull();
  });

  it("findUnique works with a compound unique key", async () => {
    const own = await tenant.warehouse.findUnique({
      where: { organizationId_code: { organizationId: a.id, code: "A-1" } },
    });
    expect(own?.id).toBe(a.warehouseIds[0]);
    // The compound key names organization B, the scope adds A: nothing matches.
    expect(
      await tenant.warehouse.findUnique({
        where: { organizationId_code: { organizationId: b.id, code: "B-1" } },
      }),
    ).toBeNull();
  });

  it("findUniqueOrThrow and findFirstOrThrow give the same 404 for another organization's ID as for a missing ID", async () => {
    const missing = "01990000-0000-7000-8000-000000000000";
    const bodies: unknown[] = [];
    for (const id of [b.warehouseIds[0], missing]) {
      for (const call of [
        () => tenant.warehouse.findUniqueOrThrow({ where: { id } }),
        () => tenant.warehouse.findFirstOrThrow({ where: { id } }),
      ]) {
        const error = await failure(call());
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(404);
        bodies.push(await (error as ApiError).toResponse().json());
      }
    }
    expect(new Set(bodies.map((x) => JSON.stringify(x))).size).toBe(1);
    expect(bodies[0]).toMatchObject({ code: "NOT_FOUND", details: null });
  });

  it("count, aggregate and groupBy only cover the organization", async () => {
    expect(await tenant.warehouse.count()).toBe(5);
    const aggregate = await tenant.stockLevel.aggregate({ _sum: { quantity: true }, _count: true });
    expect(aggregate._sum.quantity).toBe(10);
    expect(aggregate._count).toBe(1);
    const groups = await tenant.warehouse.groupBy({ by: ["archivedAt"], _count: { _all: true } });
    expect(groups).toEqual([{ archivedAt: null, _count: { _all: 5 } }]);
  });

  it("groupBy rejects a different organizationId in where", async () => {
    await expect(
      tenant.warehouse.groupBy({ by: ["archivedAt"], where: whereOf(b), _count: true }),
    ).rejects.toThrow(/organizationId/);
  });

  it("paginates with cursor, take and orderBy without crossing into the other organization", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const rows = await tenant.warehouse.findMany({
        orderBy: { code: "asc" },
        take: 2,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) break;
      seen.push(...rows.map((r) => r.code));
      cursor = rows[rows.length - 1].id;
    }
    expect(seen).toEqual(["A-1", "A-2", "A-3", "A-4", "A-5"]);
  });

  it("does not leak rows when the cursor is an ID of another organization", async () => {
    const rows = await tenant.warehouse.findMany({
      orderBy: { code: "asc" },
      take: 10,
      cursor: { id: b.warehouseIds[2] },
    });
    expect(rows.every((r) => r.organizationId === a.id)).toBe(true);
  });

  it("allows including the organization or the plan as plain rows", async () => {
    const warehouse = await tenant.warehouse.findFirstOrThrow({ include: { organization: true } });
    expect(warehouse.organization.id).toBe(a.id);
    const subscription = await tenant.subscription.findFirstOrThrow({
      include: { plan: { select: { name: true } } },
    });
    expect(subscription.plan.name).toBe("Starter");
  });

  it("rejects an include that walks from a shared row to other organizations' rows", async () => {
    await expect(
      tenant.subscription.findFirst({
        include: { plan: { include: { subscriptions: true } } },
      }),
    ).rejects.toThrow(/plan/);
    await expect(
      tenant.warehouse.findFirst({
        select: { organization: { select: { users: true } } },
      }),
    ).rejects.toThrow(/organization/);
    await expect(
      tenant.warehouse.findFirst({
        include: { organization: { include: { users: true } } },
      }),
    ).rejects.toThrow(/organization/);
  });
});

describe("creates", () => {
  const warehouse = (code: string, extra: object = {}) => ({
    data: { code, name: code, ...extra },
  });

  it("create fills organizationId from the context when the data has none", async () => {
    const created = await tenant.warehouse.create(warehouse("NEW-1") as Prisma.WarehouseCreateArgs);
    expect(created.organizationId).toBe(a.id);
  });

  it("create accepts the same organizationId", async () => {
    const created = await tenant.warehouse.create(
      warehouse("NEW-2", whereOf(a)) as Prisma.WarehouseCreateArgs,
    );
    expect(created.organizationId).toBe(a.id);
  });

  it("create rejects a different organizationId and writes nothing", async () => {
    await expect(
      tenant.warehouse.create(warehouse("NEW-3", whereOf(b)) as Prisma.WarehouseCreateArgs),
    ).rejects.toThrow(/organizationId/);
    expect(await prisma.warehouse.count({ where: { code: "NEW-3" } })).toBe(0);
  });

  it("create rejects relation keys (checked input and nested writes)", async () => {
    await expect(
      tenant.warehouse.create(
        warehouse("NEW-4", {
          organization: { connect: { id: b.id } },
        }) as Prisma.WarehouseCreateArgs,
      ),
    ).rejects.toThrow(/organization/);
    await expect(
      tenant.warehouse.create(
        warehouse("NEW-5", {
          ...whereOf(a),
          stockLevels: {
            create: { organizationId: b.id, productId: b.productIds[0], quantity: 1 },
          },
        }) as Prisma.WarehouseCreateArgs,
      ),
    ).rejects.toThrow(/stockLevels/);
    expect(await prisma.warehouse.count({ where: { code: { in: ["NEW-4", "NEW-5"] } } })).toBe(0);
  });

  it("createMany fills organizationId on every row", async () => {
    const result = await tenant.warehouse.createMany({
      data: [
        { code: "MANY-1", name: "x" },
        { code: "MANY-2", name: "x", ...whereOf(a) },
      ] as never,
    });
    expect(result.count).toBe(2);
    const rows = await prisma.warehouse.findMany({ where: { code: { startsWith: "MANY-" } } });
    expect(rows.every((r) => r.organizationId === a.id)).toBe(true);
  });

  it("createMany rejects the whole batch when one row names another organization", async () => {
    await expect(
      tenant.warehouse.createMany({
        data: [
          { code: "MANY-3", name: "x", ...whereOf(a) },
          { code: "MANY-4", name: "x", ...whereOf(b) },
        ] as never,
      }),
    ).rejects.toThrow(/organizationId/);
    expect(await prisma.warehouse.count({ where: { code: { startsWith: "MANY-" } } })).toBe(0);
  });

  it("createManyAndReturn returns rows of the organization", async () => {
    const rows = await tenant.warehouse.createManyAndReturn({
      data: [{ code: "RET-1", name: "x" }] as never,
    });
    expect(rows.map((r) => r.organizationId)).toEqual([a.id]);
  });
});

describe("updates", () => {
  it("update changes a row of the organization", async () => {
    const updated = await tenant.warehouse.update({
      where: { id: a.warehouseIds[0] },
      data: { name: "Renamed" },
    });
    expect(updated.name).toBe("Renamed");
  });

  it("update on an ID of another organization gives ApiError 404 and changes nothing", async () => {
    const error = await failure(
      tenant.warehouse.update({ where: { id: b.warehouseIds[0] }, data: { name: "Hacked" } }),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
    expect((error as ApiError).code).toBe("NOT_FOUND");
    expect(
      (await prisma.warehouse.findUniqueOrThrow({ where: { id: b.warehouseIds[0] } })).name,
    ).toBe("Gudang B1");
  });

  it("gives the same 404 body for another organization's ID as for a missing ID (update and delete)", async () => {
    const missing = "01990000-0000-7000-8000-000000000000";
    const bodies: string[] = [];
    for (const id of [b.warehouseIds[0], missing]) {
      for (const call of [
        () => tenant.warehouse.update({ where: { id }, data: { name: "x" } }),
        () => tenant.warehouse.delete({ where: { id } }),
      ]) {
        const error = await failure(call());
        expect(error).toBeInstanceOf(ApiError);
        bodies.push(JSON.stringify(await (error as ApiError).toResponse().json()));
      }
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it("update rejects any organizationId in data, even the same one", async () => {
    for (const org of [a, b]) {
      await expect(
        tenant.warehouse.update({
          where: { id: a.warehouseIds[0] },
          data: { organizationId: org.id },
        }),
      ).rejects.toThrow(/organizationId/);
    }
  });

  it("update rejects relation keys in data", async () => {
    await expect(
      tenant.warehouse.update({
        where: { id: a.warehouseIds[0] },
        data: { organization: { connect: { id: b.id } } } as never,
      }),
    ).rejects.toThrow(/organization/);
  });

  it("updateMany only touches the organization's rows", async () => {
    const result = await tenant.warehouse.updateMany({ data: { address: "Jl. Baru" } });
    expect(result.count).toBe(5);
    expect(await prisma.warehouse.count({ where: { address: "Jl. Baru" } })).toBe(5);
    expect(await prisma.warehouse.count({ where: { organizationId: b.id, address: null } })).toBe(
      5,
    );
  });

  it("updateMany with a where for another organization is rejected", async () => {
    await expect(
      tenant.warehouse.updateMany({ where: whereOf(b), data: { address: "x" } }),
    ).rejects.toThrow(/organizationId/);
  });

  it("updateMany with an OR for another organization touches nothing of it", async () => {
    await tenant.warehouse.updateMany({
      where: { OR: [{ organizationId: b.id }, { code: "A-1" }] },
      data: { address: "only-a" },
    });
    expect(await prisma.warehouse.count({ where: { address: "only-a" } })).toBe(1);
  });

  it("updateMany rejects organizationId in data", async () => {
    await expect(tenant.warehouse.updateMany({ data: { organizationId: b.id } })).rejects.toThrow(
      /organizationId/,
    );
  });

  it("updateManyAndReturn only returns the organization's rows", async () => {
    const rows = await tenant.warehouse.updateManyAndReturn({ data: { address: "ret" } });
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.organizationId === a.id)).toBe(true);
  });

  it("upsert updates an existing row of the organization", async () => {
    const row = await tenant.warehouse.upsert({
      where: { id: a.warehouseIds[0] },
      create: { code: "UP-1", name: "x", organizationId: a.id },
      update: { name: "Upserted" },
    });
    expect(row.id).toBe(a.warehouseIds[0]);
    expect(row.name).toBe("Upserted");
  });

  it("upsert on an ID of another organization creates in its own organization and leaves the other row alone", async () => {
    const row = await tenant.warehouse.upsert({
      where: { id: b.warehouseIds[0] },
      create: { code: "UP-2", name: "x" } as never,
      update: { name: "Hacked" },
    });
    expect(row.organizationId).toBe(a.id);
    expect(row.id).not.toBe(b.warehouseIds[0]);
    expect(
      (await prisma.warehouse.findUniqueOrThrow({ where: { id: b.warehouseIds[0] } })).name,
    ).toBe("Gudang B1");
  });

  it("upsert rejects a different organizationId in create and any organizationId in update", async () => {
    await expect(
      tenant.warehouse.upsert({
        where: { id: a.warehouseIds[0] },
        create: { code: "UP-3", name: "x", organizationId: b.id },
        update: {},
      }),
    ).rejects.toThrow(/organizationId/);
    await expect(
      tenant.warehouse.upsert({
        where: { id: a.warehouseIds[0] },
        create: { code: "UP-4", name: "x", organizationId: a.id },
        update: { organizationId: b.id },
      }),
    ).rejects.toThrow(/organizationId/);
  });
});

describe("deletes", () => {
  async function fresh(org: Org, code: string) {
    return prisma.warehouse.create({
      data: { organizationId: org.id, code, name: code },
    });
  }

  it("delete removes a row of the organization", async () => {
    const row = await fresh(a, "DEL-A");
    await tenant.warehouse.delete({ where: { id: row.id } });
    expect(await prisma.warehouse.count({ where: { id: row.id } })).toBe(0);
  });

  it("delete on an ID of another organization gives ApiError 404 and deletes nothing", async () => {
    const row = await fresh(b, "DEL-B");
    const error = await failure(tenant.warehouse.delete({ where: { id: row.id } }));
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
    expect(await prisma.warehouse.count({ where: { id: row.id } })).toBe(1);
  });

  it("deleteMany only deletes the organization's rows", async () => {
    await fresh(a, "DEL-1");
    await fresh(a, "DEL-2");
    await fresh(b, "DEL-3");
    const result = await tenant.warehouse.deleteMany({ where: { code: { startsWith: "DEL-" } } });
    expect(result.count).toBe(2);
    expect(await prisma.warehouse.count({ where: { code: "DEL-3" } })).toBe(1);
  });

  it("deleteMany with a where for another organization is rejected", async () => {
    await fresh(b, "DEL-4");
    await expect(tenant.warehouse.deleteMany({ where: whereOf(b) })).rejects.toThrow(
      /organizationId/,
    );
    expect(await prisma.warehouse.count({ where: { code: "DEL-4" } })).toBe(1);
  });
});

describe("raw SQL", () => {
  it("is refused on the client and inside a transaction", async () => {
    const raw = tenant as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    for (const name of ["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"]) {
      await expect(raw[name]("SELECT 1"), name).rejects.toThrow(/raw/i);
    }
    await expect(
      tenant.$transaction(async (tx) => {
        const rawTx = tx as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
        await rawTx.$queryRawUnsafe("SELECT 1");
      }),
    ).rejects.toThrow(/raw/i);
  });
});

describe("$transaction", () => {
  it("interactive form: stays inside the organization and rolls back", async () => {
    const error = await failure(
      tenant.$transaction(async (tx) => {
        expect(await tx.warehouse.count()).toBe(5);
        await tx.warehouse.create({ data: { code: "TX-1", name: "x", organizationId: a.id } });
        await expect(
          tx.warehouse.create({ data: { code: "TX-2", name: "x", organizationId: b.id } }),
        ).rejects.toThrow(/organizationId/);
        await expect(
          tx.warehouse.findUnique({ where: { id: b.warehouseIds[0] } }),
        ).resolves.toBeNull();
        await expect(
          tx.warehouse.update({ where: { id: b.warehouseIds[0] }, data: { name: "x" } }),
        ).rejects.toBeInstanceOf(ApiError);
        throw new Error("boom");
      }),
    );
    expect((error as Error).message).toBe("boom");
    expect(await prisma.warehouse.count({ where: { code: { startsWith: "TX-" } } })).toBe(0);
  });

  it("interactive form: commits when the callback returns", async () => {
    await tenant.$transaction(async (tx) => {
      await tx.warehouse.create({ data: { code: "TX-3", name: "x", organizationId: a.id } });
    });
    expect(await prisma.warehouse.count({ where: { code: "TX-3" } })).toBe(1);
  });

  it("array form: every operation stays inside the organization", async () => {
    await prisma.warehouse.createMany({
      data: [
        { organizationId: a.id, code: "ARR-A", name: "x" },
        { organizationId: b.id, code: "ARR-B", name: "x" },
      ],
    });
    const [rows, count, deleted] = await tenant.$transaction([
      tenant.warehouse.findMany(),
      tenant.warehouse.count(),
      tenant.warehouse.deleteMany({ where: { code: { startsWith: "ARR-" } } }),
    ]);
    expect(rows.every((r) => r.organizationId === a.id)).toBe(true);
    expect(count).toBe(6);
    expect(deleted.count).toBe(1);
    expect(await prisma.warehouse.count({ where: { code: "ARR-B" } })).toBe(1);
  });
});

describe("Organization (scoped by id)", () => {
  it("reads only the organization itself", async () => {
    const rows = await tenant.organization.findMany();
    expect(rows.map((r) => r.id)).toEqual([a.id]);
    expect(await tenant.organization.count()).toBe(1);
    expect(await tenant.organization.findUnique({ where: { id: b.id } })).toBeNull();
    expect(await tenant.organization.findFirst({ where: { id: b.id } })).toBeNull();
  });

  it("updates its own name and address", async () => {
    const row = await tenant.organization.update({
      where: { id: a.id },
      data: { name: "Nama Baru", address: "Jl. A" },
    });
    expect(row.name).toBe("Nama Baru");
  });

  it("gives ApiError 404 when updating another organization", async () => {
    const error = await failure(
      tenant.organization.update({ where: { id: b.id }, data: { name: "Hacked" } }),
    );
    expect((error as ApiError).status).toBe(404);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: b.id } })).name).toBe(
      "Org B",
    );
  });

  it("may change only name and address (allowlist)", async () => {
    for (const data of [{ slug: "newslug" }, { status: "ACTIVE" }, { id: b.id }] as const) {
      const field = Object.keys(data)[0];
      await expect(
        tenant.organization.update({ where: { id: a.id }, data: data as never }),
        field,
      ).rejects.toThrow(new RegExp(`"${field}"`));
      await expect(tenant.organization.updateMany({ data: data as never }), field).rejects.toThrow(
        new RegExp(`"${field}"`),
      );
    }
    const after = await prisma.organization.findUniqueOrThrow({ where: { id: a.id } });
    expect(after).toMatchObject({ status: "TRIAL", slug: "orga" });
    expect(after.id).toBe(a.id);
  });

  it("changes name and address together", async () => {
    const result = await tenant.organization.updateMany({
      data: { name: "N", address: "Jl. N" },
    });
    expect(result.count).toBe(1);
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({
      name: "Org B",
      address: null,
    });
  });

  it("refuses create, upsert and delete", async () => {
    await expect(tenant.organization.create({ data: { name: "x", slug: "x" } })).rejects.toThrow(
      /organization/i,
    );
    await expect(
      tenant.organization.upsert({
        where: { id: a.id },
        create: { name: "x", slug: "x" },
        update: {},
      }),
    ).rejects.toThrow(/organization/i);
    await expect(tenant.organization.delete({ where: { id: a.id } })).rejects.toThrow(
      /organization/i,
    );
    await expect(tenant.organization.deleteMany()).rejects.toThrow(/organization/i);
  });

  it("refuses an include that walks to other organizations' rows", async () => {
    await expect(
      tenant.organization.findFirst({
        include: { subscription: { include: { plan: { include: { subscriptions: true } } } } },
      }),
    ).rejects.toThrow(/plan/);
  });
});

describe("Subscription (read only)", () => {
  it("can be read, only its own", async () => {
    const rows = await tenant.subscription.findMany();
    expect(rows.map((r) => r.organizationId)).toEqual([a.id]);
  });

  it("refuses every write", async () => {
    const own = { organizationId: a.id };
    const writes: Promise<unknown>[] = [
      tenant.subscription.create({
        data: {
          ...own,
          planId: a.planId,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(),
          graceUntil: new Date(),
        },
      }),
      tenant.subscription.update({ where: { id: a.subscriptionId }, data: { billingDay: 5 } }),
      tenant.subscription.updateMany({ data: { billingDay: 5 } }),
      tenant.subscription.upsert({
        where: { id: a.subscriptionId },
        create: {
          ...own,
          planId: a.planId,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(),
          graceUntil: new Date(),
        },
        update: {},
      }),
      tenant.subscription.delete({ where: { id: a.subscriptionId } }),
      tenant.subscription.deleteMany(),
    ];
    for (const write of writes) await expect(write).rejects.toThrow(/Subscription.*read-only/);
    expect(await prisma.subscription.count()).toBe(2);
    expect(
      (await prisma.subscription.findUniqueOrThrow({ where: { id: a.subscriptionId } })).billingDay,
    ).toBeNull();
  });
});

describe("TenantClient type", () => {
  it("hides connection control, raw SQL and $extends", () => {
    type Has<K extends string> = K extends keyof TenantClient ? true : false;
    // Checked by `pnpm typecheck`: a tenant handler must not be able to disconnect the shared client.
    expectTypeOf<Has<"$disconnect">>().toEqualTypeOf<false>();
    expectTypeOf<Has<"$connect">>().toEqualTypeOf<false>();
    expectTypeOf<Has<"$on">>().toEqualTypeOf<false>();
    expectTypeOf<Has<"$extends">>().toEqualTypeOf<false>();
    expectTypeOf<Has<"$queryRaw">>().toEqualTypeOf<false>();
    expectTypeOf<Has<"$executeRawUnsafe">>().toEqualTypeOf<false>();
    expectTypeOf<Has<"$transaction">>().toEqualTypeOf<true>();
  });
});

describe("Plan (global, read only)", () => {
  it("can be read", async () => {
    expect((await tenant.plan.findMany()).map((p) => p.name)).toEqual(["Starter"]);
    expect(await tenant.plan.count()).toBe(1);
  });

  it("cannot be written", async () => {
    await expect(
      tenant.plan.create({
        data: { name: "X", priceIdr: 1, maxWarehouses: 1, maxProducts: 1, maxMembers: 1 },
      }),
    ).rejects.toThrow(/plan/i);
    await expect(tenant.plan.updateMany({ data: { priceIdr: 0 } })).rejects.toThrow(/plan/i);
    await expect(tenant.plan.deleteMany()).rejects.toThrow(/plan/i);
    expect((await prisma.plan.findFirstOrThrow()).priceIdr).toBe(300_000);
  });

  it("cannot expose other organizations through its relations", async () => {
    await expect(tenant.plan.findMany({ include: { subscriptions: true } })).rejects.toThrow(
      /plan/i,
    );
    await expect(tenant.plan.findMany({ select: { invoices: true } })).rejects.toThrow(/plan/i);
    await expect(
      tenant.plan.findMany({ where: { subscriptions: { some: { organizationId: b.id } } } }),
    ).rejects.toThrow(/plan/i);
  });
});

describe("WebhookEvent (denied)", () => {
  it("cannot be read or written", async () => {
    await prisma.webhookEvent.create({ data: { provider: "xendit", eventId: "e1", payload: {} } });
    await expect(tenant.webhookEvent.findMany()).rejects.toThrow(/webhookEvent/i);
    await expect(tenant.webhookEvent.count()).rejects.toThrow(/webhookEvent/i);
    await expect(
      tenant.webhookEvent.create({ data: { provider: "x", eventId: "e2", payload: {} } }),
    ).rejects.toThrow(/webhookEvent/i);
  });
});

describe("context", () => {
  it("scopes to the organization of the context it was built with", async () => {
    const other = createTenantClient(prisma, contextOf(b));
    expect((await other.warehouse.findMany()).every((r) => r.organizationId === b.id)).toBe(true);
    expect(await other.warehouse.findUnique({ where: { id: a.warehouseIds[0] } })).toBeNull();
  });
});
