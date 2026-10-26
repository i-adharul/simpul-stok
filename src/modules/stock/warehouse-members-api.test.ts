import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../lib/env";
import type { PrismaClient } from "../../generated/prisma/client";
import { assertTestDatabaseUrl, createTestPrisma } from "../../test/test-database";
import {
  callRoute,
  cookieFor,
  createTwoTenants,
  type TwoTenants,
} from "../../test/tenant-isolation/fixtures";
import { createTenantClient } from "../platform/tenant-client";
import { replaceWarehouseMembers } from "./warehouse-members-service";
import * as membersRoute from "../../app/api/warehouses/[id]/members/route";

let prisma: PrismaClient;
let t: TwoTenants;

beforeAll(() => {
  prisma = createTestPrisma(assertTestDatabaseUrl(env.TEST_DATABASE_URL));
});
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  t = await createTwoTenants(prisma);
});

type Role = "OWNER" | "WAREHOUSE_ADMIN" | "VIEWER";

const call = async (
  method: "GET" | "PUT",
  role: Role,
  id: string,
  body?: unknown,
  as: "a" | "b" = "a",
) =>
  callRoute(membersRoute[method], {
    method,
    path: `/api/warehouses/${id}/members`,
    body,
    cookie: await cookieFor(t[as].users[role]),
    params: { id },
  });

const assignedTo = async (warehouseId: string) =>
  (await prisma.userWarehouse.findMany({ where: { warehouseId }, select: { userId: true } }))
    .map((row) => row.userId)
    .sort();

async function extraUser(
  organizationId: string,
  role: "WAREHOUSE_ADMIN" | "VIEWER" | "OWNER",
  isActive = true,
) {
  const tag = Math.random().toString(36).slice(2);
  return (
    await prisma.user.create({
      data: {
        organizationId,
        email: `${tag}@extra.test`,
        name: `Extra ${tag}`,
        passwordHash: "h",
        role,
        isActive,
      },
    })
  ).id;
}

describe("GET /api/warehouses/:id/members", () => {
  it("lists active Warehouse Admins and Viewers with the assigned flag, never the Owner", async () => {
    const inactive = await extraUser(t.a.organizationId, "VIEWER", false);
    const unassigned = await extraUser(t.a.organizationId, "VIEWER");
    const res = await call("GET", "OWNER", t.a.warehouseId);
    expect(res.status).toBe(200);
    const { candidates } = (await res.json()) as {
      candidates: { id: string; role: string; assigned: boolean; email: string; name: string }[];
    };
    const ids = candidates.map((c) => c.id);
    expect(ids).toContain(t.a.users.WAREHOUSE_ADMIN);
    expect(ids).toContain(unassigned);
    expect(ids).not.toContain(t.a.users.OWNER);
    expect(ids).not.toContain(inactive);
    expect(candidates.find((c) => c.id === unassigned)?.assigned).toBe(false);
    expect(candidates.find((c) => c.id === t.a.users.VIEWER)?.assigned).toBe(true);
    expect(Object.keys(candidates[0]).sort()).toEqual(["assigned", "email", "id", "name", "role"]);
  });

  it("returns 403 for a Warehouse Admin and a Viewer", async () => {
    for (const role of ["WAREHOUSE_ADMIN", "VIEWER"] as const) {
      expect((await call("GET", role, t.a.warehouseId)).status).toBe(403);
    }
  });

  it("returns 404 for another organization's warehouse and for an archived one", async () => {
    expect((await call("GET", "OWNER", t.b.warehouseId)).status).toBe(404);
    const archived = await prisma.warehouse.create({
      data: {
        organizationId: t.a.organizationId,
        code: "ARC",
        name: "Archived",
        archivedAt: new Date(),
      },
    });
    expect((await call("GET", "OWNER", archived.id)).status).toBe(404);
  });
});

describe("PUT /api/warehouses/:id/members", () => {
  it("replaces the assigned set and is idempotent", async () => {
    const extra = await extraUser(t.a.organizationId, "WAREHOUSE_ADMIN");
    const body = { userIds: [t.a.users.VIEWER, extra] };
    const first = await call("PUT", "OWNER", t.a.warehouseId, body);
    expect(first.status).toBe(200);
    const json = (await first.json()) as { candidates: { id: string; assigned: boolean }[] };
    expect(
      json.candidates
        .filter((c) => c.assigned)
        .map((c) => c.id)
        .sort(),
    ).toEqual([t.a.users.VIEWER, extra].sort());
    expect(await assignedTo(t.a.warehouseId)).toEqual([t.a.users.VIEWER, extra].sort());

    const second = await call("PUT", "OWNER", t.a.warehouseId, body);
    expect(second.status).toBe(200);
    expect(await assignedTo(t.a.warehouseId)).toEqual([t.a.users.VIEWER, extra].sort());
    const rows = await prisma.userWarehouse.findMany({ where: { warehouseId: t.a.warehouseId } });
    expect(rows.every((row) => row.organizationId === t.a.organizationId)).toBe(true);
  });

  it("clears every assignment with an empty list and leaves other warehouses alone", async () => {
    const other = await prisma.warehouse.findFirstOrThrow({
      where: { organizationId: t.a.organizationId, id: { not: t.a.warehouseId } },
    });
    await prisma.userWarehouse.create({
      data: {
        organizationId: t.a.organizationId,
        userId: t.a.users.VIEWER,
        warehouseId: other.id,
      },
    });
    const res = await call("PUT", "OWNER", t.a.warehouseId, { userIds: [] });
    expect(res.status).toBe(200);
    expect(await assignedTo(t.a.warehouseId)).toEqual([]);
    expect(await assignedTo(other.id)).toEqual([t.a.users.VIEWER]);
  });

  it("returns 400 for the Owner, an inactive user, malformed or duplicate ids, and too many", async () => {
    const before = await assignedTo(t.a.warehouseId);
    const inactive = await extraUser(t.a.organizationId, "VIEWER", false);
    const bodies = [
      { userIds: [t.a.users.OWNER] },
      { userIds: [inactive] },
      { userIds: ["not-a-uuid"] },
      { userIds: [t.a.users.VIEWER, t.a.users.VIEWER] },
      { userIds: Array.from({ length: 201 }, () => crypto.randomUUID()) },
      {},
      { userIds: [], organizationId: t.b.organizationId },
    ];
    for (const body of bodies) {
      const res = await call("PUT", "OWNER", t.a.warehouseId, body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe("VALIDATION_ERROR");
    }
    expect(await assignedTo(t.a.warehouseId)).toEqual(before);
  });

  it("returns 403 for a Warehouse Admin and a Viewer, before validating the body", async () => {
    for (const role of ["WAREHOUSE_ADMIN", "VIEWER"] as const) {
      expect((await call("PUT", role, t.a.warehouseId, {})).status).toBe(403);
    }
  });

  it("returns 404 for another organization's warehouse and for an archived one", async () => {
    expect((await call("PUT", "OWNER", t.b.warehouseId, { userIds: [] })).status).toBe(404);
    const archived = await prisma.warehouse.create({
      data: {
        organizationId: t.a.organizationId,
        code: "ARC",
        name: "Archived",
        archivedAt: new Date(),
      },
    });
    expect((await call("PUT", "OWNER", archived.id, { userIds: [] })).status).toBe(404);
  });

  it("answers a user id of another organization with the same 404 as a missing id, changing nothing", async () => {
    const before = await assignedTo(t.a.warehouseId);
    const foreign = await call("PUT", "OWNER", t.a.warehouseId, {
      userIds: [t.a.users.VIEWER, t.b.users.VIEWER],
    });
    const missing = await call("PUT", "OWNER", t.a.warehouseId, {
      userIds: [t.a.users.VIEWER, "019a0000-0000-7000-8000-000000000000"],
    });
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await foreign.text()).toBe(await missing.text());
    expect(await assignedTo(t.a.warehouseId)).toEqual(before);
    expect(await assignedTo(t.b.warehouseId)).toEqual(
      [t.b.users.VIEWER, t.b.users.WAREHOUSE_ADMIN].sort(),
    );
  });
});

describe("PUT /api/warehouses/:id/members under concurrency", () => {
  it("serializes parallel replacements: no 500, one winning set, no duplicate rows", async () => {
    const pool = [t.a.users.VIEWER, t.a.users.WAREHOUSE_ADMIN];
    for (let i = 0; i < 3; i++) pool.push(await extraUser(t.a.organizationId, "VIEWER"));
    // Ten different sets drawn from the same five users, so replacements overlap on the unique key.
    const sets = Array.from({ length: 10 }, (_, i) => pool.filter((_, j) => ((i + 1) >> j) & 1));

    const responses = await Promise.all(
      sets.map((userIds) => call("PUT", "OWNER", t.a.warehouseId, { userIds })),
    );

    expect(responses.map((r) => r.status).filter((s) => s >= 500)).toEqual([]);
    const final = await assignedTo(t.a.warehouseId);
    expect(sets.map((set) => [...set].sort())).toContainEqual(final);
    expect(new Set(final).size).toBe(final.length);
  });
});

describe("replaceWarehouseMembers (service)", () => {
  it("gives a foreign user id the same 404 as a missing one and leaves every assignment untouched", async () => {
    const db = createTenantClient(prisma, {
      userId: t.a.users.OWNER,
      organizationId: t.a.organizationId,
      role: "OWNER",
      warehouseIds: [],
    });
    const before = await assignedTo(t.a.warehouseId);
    const run = (id: string) =>
      replaceWarehouseMembers(db, t.a.organizationId, t.a.warehouseId, [t.a.users.VIEWER, id]).then(
        () => null,
        (e: { status: number; toResponse: () => Response }) => e,
      );
    const foreign = await run(t.b.users.VIEWER);
    const missing = await run("019a0000-0000-7000-8000-000000000000");
    expect(foreign?.status).toBe(404);
    expect(await foreign?.toResponse().text()).toBe(await missing?.toResponse().text());
    expect(await assignedTo(t.a.warehouseId)).toEqual(before);
  });
});
