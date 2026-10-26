import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import { ApiError, ERROR_CODES, notFoundError } from "../../lib/api-error";
import { env } from "../../lib/env";
import { authorize } from "../../modules/platform/can";
import { findOwnedOrThrow } from "../../modules/platform/ownership";
import { createTenantRoute } from "../../modules/platform/tenant-route";
import { assertTestDatabaseUrl, createTestPrisma } from "../test-database";
import { rolesFor, type TenantEndpoint } from "./registry";

// Test-only routes over the warehouse table, written exactly like a real tenant endpoint: tenant
// client from withTenantRoute, authorize() first, then findOwnedOrThrow. They live under src/test, not
// src/app/api, so the route inventory does not see them. The self-test uses them to prove the harness
// (1) passes a correctly scoped route and (2) goes red, with the expected message, when one rule is broken.

// One deliberate mistake each. A route built with a flaw uses the plain Prisma client, or skips a
// step, in exactly the place a real endpoint could.
export const FLAWS = [
  "unscoped-read",
  "foreign-is-403",
  "unscoped-update",
  "unscoped-delete",
  "unscoped-list",
  "unscoped-cursor",
  "lookup-before-authorize",
  "skips-authorize",
  "trusts-body-org",
  "validates-before-authorizing",
] as const;
export type Flaw = (typeof FLAWS)[number];

const idParams = z.object({ id: z.string() });
const nameBody = z.object({ name: z.string().min(1) });
// The flawed create trusts organizationId from the body, so its schema must let it through.
const nameBodyWithOrganization = nameBody.extend({ organizationId: z.string().optional() });

export type WarehouseTestRoutes = {
  endpoints: {
    list: TenantEndpoint;
    create: TenantEndpoint;
    read: TenantEndpoint;
    update: TenantEndpoint;
    remove: TenantEndpoint;
  };
  dispose: () => Promise<void>;
};

export function createWarehouseTestRoutes(flaws: readonly Flaw[] = []): WarehouseTestRoutes {
  const has = (flaw: Flaw) => flaws.includes(flaw);
  // A correct route passes `requires`, so the role is checked before the input. These flaws authorize
  // late (in the handler, after validation or after the lookup) or not at all.
  const requiresManage =
    has("validates-before-authorizing") || has("skips-authorize") || has("lookup-before-authorize")
      ? undefined
      : ("warehouse.manage" as const);
  const authorizeInHandler = (ctx: Parameters<typeof authorize>[0]) => {
    if (!has("skips-authorize")) authorize(ctx, "warehouse.manage");
  };
  // The routes build their own client from the test database, like route modules do from DATABASE_URL.
  const prisma: PrismaClient = createTestPrisma(assertTestDatabaseUrl(env.TEST_DATABASE_URL));
  const withTenantRoute = createTenantRoute({ prisma, secret: env.SESSION_SECRET });

  const listRoute = withTenantRoute(
    async (_request, input, { ctx, db }) => {
      const cursor = input.query.cursor;
      const unscoped = has("unscoped-list") || (has("unscoped-cursor") && cursor !== undefined);
      const rows = unscoped
        ? await prisma.warehouse.findMany({
            where: cursor ? { id: { gte: cursor } } : {},
            orderBy: { id: "asc" },
          })
        : await db.warehouse.findMany({
            where: cursor ? { id: { gt: cursor } } : {},
            orderBy: { id: "asc" },
            take: 50,
          });
      return Response.json({ items: rows.map((row) => ({ id: row.id, name: row.name })) });
    },
    { query: z.object({ cursor: z.string().optional() }), requires: "warehouse.read" },
  );

  const createRoute = withTenantRoute(
    async (_request, input, { ctx, db }) => {
      if (!requiresManage) authorizeInHandler(ctx);
      const data = { code: `T-${randomUUID().slice(0, 8)}`.toUpperCase(), name: input.body.name };
      const body = input.body as { organizationId?: string };
      const row = has("trusts-body-org")
        ? await prisma.warehouse.create({
            data: { ...data, organizationId: body.organizationId ?? ctx.organizationId },
          })
        : await db.warehouse.create({ data: { ...data, organizationId: ctx.organizationId } });
      return Response.json({ id: row.id }, { status: 201 });
    },
    {
      body: has("trusts-body-org") ? nameBodyWithOrganization : nameBody,
      requires: requiresManage,
    },
  );

  const readRoute = withTenantRoute(
    async (_request, input, { ctx, db }) => {
      const { id } = input.params;
      if (has("unscoped-read") || has("foreign-is-403")) {
        const row = await prisma.warehouse.findFirst({ where: { id } });
        if (!row) throw notFoundError();
        if (has("foreign-is-403") && row.organizationId !== ctx.organizationId) {
          throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Bukan milik Anda.");
        }
        return Response.json({ id: row.id, name: row.name });
      }
      const row = await findOwnedOrThrow(db, "warehouse", id);
      return Response.json({ id: row.id, name: row.name });
    },
    { params: idParams, route: "/api/test/warehouses/[id]", requires: "warehouse.read" },
  );

  const updateRoute = withTenantRoute(
    async (_request, input, { ctx, db }) => {
      const { id } = input.params;
      if (!requiresManage && !has("lookup-before-authorize")) authorizeInHandler(ctx);
      if (has("unscoped-update")) {
        const row = await prisma.warehouse.update({
          where: { id },
          data: { name: input.body.name },
        });
        return Response.json({ id: row.id, name: row.name });
      }
      await findOwnedOrThrow(db, "warehouse", id);
      if (has("lookup-before-authorize")) authorize(ctx, "warehouse.manage");
      const row = await db.warehouse.update({ where: { id }, data: { name: input.body.name } });
      return Response.json({ id: row.id, name: row.name });
    },
    {
      params: idParams,
      body: nameBody,
      route: "/api/test/warehouses/[id]",
      requires: requiresManage,
    },
  );

  // "Business data is archived, not deleted" (rule 8): DELETE archives.
  const removeRoute = withTenantRoute(
    async (_request, input, { ctx, db }) => {
      if (!requiresManage) authorizeInHandler(ctx);
      const { id } = input.params;
      const data = { archivedAt: new Date() };
      if (has("unscoped-delete")) {
        await prisma.warehouse.update({ where: { id }, data });
      } else {
        await findOwnedOrThrow(db, "warehouse", id);
        await db.warehouse.update({ where: { id }, data });
      }
      return new Response(null, { status: 204 });
    },
    {
      params: idParams,
      body: "none",
      route: "/api/test/warehouses/[id]",
      requires: requiresManage,
    },
  );

  const listModule = { GET: listRoute, POST: createRoute };
  const itemModule = { GET: readRoute, PATCH: updateRoute, DELETE: removeRoute };

  const createRow = async (
    tenants: { a: { organizationId: string }; b: { organizationId: string } },
    owner: "a" | "b",
  ) =>
    (
      await prisma.warehouse.create({
        data: {
          organizationId: tenants[owner].organizationId,
          code: `R-${randomUUID().slice(0, 8)}`.toUpperCase(),
          name: `row of ${owner}`,
        },
      })
    ).id;
  const readRow = async (client: PrismaClient, id: string) => {
    const row = await client.warehouse.findUnique({ where: { id } });
    return (
      row && { organizationId: row.organizationId, name: row.name, archivedAt: row.archivedAt }
    );
  };
  const item = {
    kind: "item" as const,
    idParam: "id",
    path: (id: string) => `/api/test/warehouses/${id}`,
    route: "test/warehouses/[id]",
    module: async () => itemModule,
    createRow,
    readRow,
  };

  return {
    endpoints: {
      list: {
        kind: "list",
        name: "GET /api/test/warehouses",
        route: "test/warehouses",
        method: "GET",
        module: async () => listModule,
        action: "warehouse.read",
        allowedRoles: rolesFor("warehouse.read"),
        path: "/api/test/warehouses",
        createRow,
        idsOf: (json) => (json as { items: { id: string }[] }).items.map((row) => row.id),
        supportsCursor: true,
      },
      create: {
        kind: "create",
        name: "POST /api/test/warehouses",
        route: "test/warehouses",
        method: "POST",
        module: async () => listModule,
        action: "warehouse.manage",
        allowedRoles: rolesFor("warehouse.manage"),
        path: "/api/test/warehouses",
        body: () => ({ name: "New warehouse" }),
        countRows: (client, organizationId) =>
          client.warehouse.count({ where: { organizationId } }),
      },
      read: {
        ...item,
        name: "GET /api/test/warehouses/[id]",
        method: "GET",
        action: "warehouse.read",
        allowedRoles: rolesFor("warehouse.read"),
      },
      update: {
        ...item,
        name: "PATCH /api/test/warehouses/[id]",
        method: "PATCH",
        action: "warehouse.manage",
        allowedRoles: rolesFor("warehouse.manage"),
        body: () => ({ name: "Renamed" }),
      },
      remove: {
        ...item,
        name: "DELETE /api/test/warehouses/[id]",
        method: "DELETE",
        action: "warehouse.manage",
        allowedRoles: rolesFor("warehouse.manage"),
      },
    },
    dispose: () => prisma.$disconnect(),
  };
}
