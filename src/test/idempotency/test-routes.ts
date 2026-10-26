import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import { notFoundError } from "../../lib/api-error";
import { env } from "../../lib/env";
import { authorize } from "../../modules/platform/can";
import { markReplayed, runIdempotent } from "../../modules/platform/idempotency";
import { assertOwnedIds } from "../../modules/platform/ownership";
import { createTenantRoute, type TenantRouteArgs } from "../../modules/platform/tenant-route";
import type { TenantClient } from "../../modules/platform/tenant-client";
import { assertTestDatabaseUrl, createTestPrisma } from "../test-database";
import { rolesFor, type CreateEndpoint } from "../tenant-isolation/registry";

// A test-only stock write, written exactly like the real receive endpoint will be (E4): the receipt
// is a StockMovement row. It lives under src/test, not src/app/api, so the route inventory does not
// see it. idempotency.test.ts proves the wrapper with it, and the harness self-test uses it to prove
// the registry check "write without a valid Idempotency-Key gets 400".

export const IDEMPOTENCY_FLAWS = [
  "ignores-idempotency-header",
  "never-calls-runIdempotent",
  "trusts-foreign-product",
] as const;
export type IdempotencyFlaw = (typeof IDEMPOTENCY_FLAWS)[number];

export const RECEIPT_ENDPOINT = "POST /api/test/receipts";

const bodySchema = z.object({
  warehouseId: z.uuid(),
  productId: z.uuid(),
  quantity: z.number().int().positive(),
});

async function loadReceipt(db: TenantClient, id: string) {
  const row = await db.stockMovement.findFirst({ where: { id } });
  if (!row) throw notFoundError();
  return row;
}
type Receipt = Awaited<ReturnType<typeof loadReceipt>>;

// The response is always built from the loaded row, for the first call and for a replay.
const receiptBody = (row: Receipt) => ({
  id: row.id,
  warehouseId: row.warehouseId,
  productId: row.productId,
  quantity: row.quantityDelta,
  createdAt: row.createdAt.toISOString(),
});

export type IdempotentTestRoutes = {
  // The handler, called like a Route Handler (idempotency.test.ts calls it directly).
  POST: (request: Request) => Promise<Response>;
  // The registry entry for the harness self-test.
  endpoint: CreateEndpoint;
  prisma: PrismaClient;
  dispose: () => Promise<void>;
};

export function createIdempotentTestRoutes(
  options: { flaws?: readonly IdempotencyFlaw[]; workDelayMs?: number } = {},
): IdempotentTestRoutes {
  const ignoresHeader = options.flaws?.includes("ignores-idempotency-header") ?? false;
  const trustsForeignProduct = options.flaws?.includes("trusts-foreign-product") ?? false;
  const neverCalls = options.flaws?.includes("never-calls-runIdempotent") ?? false;
  const prisma = createTestPrisma(assertTestDatabaseUrl(env.TEST_DATABASE_URL));
  const withTenantRoute = createTenantRoute({ prisma, secret: env.SESSION_SECRET });

  // The flaw: the route forgets the option. It then has no key, so it invents one.
  const idempotent = ignoresHeader ? {} : { idempotent: true as const };
  const POST = withTenantRoute(
    async (_request, input, tenant) => {
      const { ctx, db } = tenant;
      const { warehouseId, productId, quantity } = input.body;
      // Rule of ADR 0012: authorize BEFORE runIdempotent, so a caller who may not act is never shown
      // a replay.
      authorize(ctx, "stock.receive", { warehouseId });
      await assertOwnedIds(db, "warehouse", [warehouseId]);
      // The flaw: the product id is used as given, so a product of another organization is accepted.
      if (!trustsForeignProduct) await assertOwnedIds(db, "product", [productId]);
      if (neverCalls) {
        // The flaw: the option and the header check are there, but the effect runs directly, so a
        // repeated key acts again.
        const row = await db.stockMovement.create({
          data: {
            organizationId: ctx.organizationId,
            warehouseId,
            productId,
            quantityDelta: quantity,
            type: "RECEIVE",
            createdById: ctx.userId,
          },
        });
        return Response.json(receiptBody(row), { status: 201 });
      }
      const key = (tenant as Partial<TenantRouteArgs> & { idempotencyKey?: string }).idempotencyKey;
      const { result, replayed } = await runIdempotent(
        db,
        { key: key ?? randomUUID(), endpoint: RECEIPT_ENDPOINT },
        {
          work: async (tx) => {
            const row = await tx.stockMovement.create({
              data: {
                organizationId: ctx.organizationId,
                warehouseId,
                productId,
                quantityDelta: quantity,
                type: "RECEIVE",
                createdById: ctx.userId,
              },
            });
            if (options.workDelayMs) {
              await new Promise((resolve) => setTimeout(resolve, options.workDelayMs));
            }
            return row.id;
          },
          load: loadReceipt,
          access: { ctx, action: "stock.receive", warehouseIdOf: (row) => row.warehouseId },
        },
      );
      return markReplayed(Response.json(receiptBody(result), { status: 201 }), replayed);
    },
    { body: bodySchema, ...idempotent },
  );

  const endpoint: CreateEndpoint = {
    kind: "create",
    name: RECEIPT_ENDPOINT,
    route: "test/receipts",
    method: "POST",
    module: async () => ({ POST }),
    action: "stock.receive",
    allowedRoles: rolesFor("stock.receive"),
    idempotent: true,
    path: "/api/test/receipts",
    body: (t) => ({ warehouseId: t.a.warehouseId, productId: t.a.productId, quantity: 3 }),
    countRows: (client, organizationId) =>
      client.stockMovement.count({ where: { organizationId } }),
    foreignBodies: (t) => [
      {
        name: "warehouse of B",
        body: { warehouseId: t.b.warehouseId, productId: t.a.productId, quantity: 3 },
        missingBody: { warehouseId: randomUUID(), productId: t.a.productId, quantity: 3 },
        status: 403,
      },
      {
        name: "product of B",
        body: { warehouseId: t.a.warehouseId, productId: t.b.productId, quantity: 3 },
        missingBody: { warehouseId: t.a.warehouseId, productId: randomUUID(), quantity: 3 },
        status: 404,
      },
    ],
  };

  return { POST, endpoint, prisma, dispose: () => prisma.$disconnect() };
}
