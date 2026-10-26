import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, ERROR_CODES, notFoundError } from "../../lib/api-error";
import {
  callRoute,
  cookieFor,
  createTwoTenants,
  type TwoTenants,
} from "../../test/tenant-isolation/fixtures";
import {
  createIdempotentTestRoutes,
  type IdempotentTestRoutes,
} from "../../test/idempotency/test-routes";
import { parseIdempotencyKey, runIdempotent } from "./idempotency";
import { createTenantClient, type TenantClient } from "./tenant-client";
import type { TenantTransaction } from "./idempotency";

// The Idempotency-Key wrapper (BL14, ADR 0012) against the test database. The HTTP-level tests call a
// test-only stock write (src/test/idempotency/test-routes.ts) that is built like the real receive
// endpoint; the runIdempotent tests call the helper directly for the cases a route cannot show.

let tenants: TwoTenants;
let routes: IdempotentTestRoutes;
let slowRoutes: IdempotentTestRoutes;
let adminOfW3: string;
let warehouse3: string;
let quantity = 100;

// Every test uses its own quantity, so it can count its own rows among those of earlier tests.
const nextQuantity = () => ++quantity;
const countReceipts = (organizationId: string, q: number) =>
  tenants.prisma.stockMovement.count({ where: { organizationId, quantityDelta: q } });

async function receive(
  handler: IdempotentTestRoutes["POST"],
  userId: string,
  body: unknown,
  key: string | null,
) {
  const response = await callRoute(handler, {
    method: "POST",
    path: "/api/test/receipts",
    cookie: await cookieFor(userId),
    body,
    headers: key === null ? undefined : { "Idempotency-Key": key },
  });
  return { response, status: response.status, text: await response.clone().text() };
}

const bodyOf = (t: "a" | "b", q: number, warehouseId?: string) => ({
  warehouseId: warehouseId ?? tenants[t].warehouseId,
  productId: tenants[t].productId,
  quantity: q,
});

beforeAll(async () => {
  routes = createIdempotentTestRoutes();
  slowRoutes = createIdempotentTestRoutes({ workDelayMs: 150 });
  tenants = await createTwoTenants(routes.prisma);
  // A second Warehouse Admin of organization A, assigned to another warehouse than the fixture admin.
  const warehouse = await tenants.prisma.warehouse.create({
    data: { organizationId: tenants.a.organizationId, code: "W3", name: "orga third" },
  });
  warehouse3 = warehouse.id;
  const admin = await tenants.prisma.user.create({
    data: {
      organizationId: tenants.a.organizationId,
      email: "admin3@orga.harness.test",
      name: "orga admin 3",
      passwordHash: "not-a-real-hash",
      role: "WAREHOUSE_ADMIN",
    },
  });
  adminOfW3 = admin.id;
  await tenants.prisma.userWarehouse.create({
    data: { organizationId: tenants.a.organizationId, userId: admin.id, warehouseId: warehouse.id },
  });
});

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(async () => {
  vi.restoreAllMocks();
  await routes.dispose();
  await slowRoutes.dispose();
});

describe("parseIdempotencyKey", () => {
  it("accepts a UUID and lower-cases it", () => {
    const key = randomUUID();
    expect(parseIdempotencyKey(key.toUpperCase())).toBe(key);
  });

  it("rejects a missing header and a value that is not a UUID with 400", () => {
    for (const value of [null, "", "not-a-uuid", "1234"]) {
      expect(() => parseIdempotencyKey(value)).toThrow(
        expect.objectContaining({ status: 400, code: ERROR_CODES.VALIDATION_ERROR }),
      );
    }
  });
});

describe("a stock write with an Idempotency-Key", () => {
  it("same key twice gives one effect and the same result", async () => {
    const q = nextQuantity();
    const key = randomUUID();
    const owner = tenants.a.users.OWNER;
    const first = await receive(routes.POST, owner, bodyOf("a", q), key);
    const second = await receive(routes.POST, owner, bodyOf("a", q), key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await countReceipts(tenants.a.organizationId, q)).toBe(1);
    expect(JSON.parse(second.text).id).toBe(JSON.parse(first.text).id);
  });

  it("the first answer and the replay have exactly the same body; only the replay header differs", async () => {
    const key = randomUUID();
    const body = bodyOf("a", nextQuantity());
    const first = await receive(routes.POST, tenants.a.users.OWNER, body, key);
    const second = await receive(routes.POST, tenants.a.users.OWNER, body, key);
    expect(second.text).toBe(first.text);
    expect(first.response.headers.get("Idempotency-Replayed")).toBeNull();
    expect(second.response.headers.get("Idempotency-Replayed")).toBe("true");
  });

  it("does not compare the body: the same key with another body replays the first result", async () => {
    const key = randomUUID();
    const q = nextQuantity();
    const first = await receive(routes.POST, tenants.a.users.OWNER, bodyOf("a", q), key);
    const other = nextQuantity();
    const second = await receive(routes.POST, tenants.a.users.OWNER, bodyOf("a", other), key);
    expect(second.text).toBe(first.text);
    expect(await countReceipts(tenants.a.organizationId, other)).toBe(0);
  });

  it("a different key gives two effects", async () => {
    const q = nextQuantity();
    const body = bodyOf("a", q);
    const first = await receive(routes.POST, tenants.a.users.OWNER, body, randomUUID());
    const second = await receive(routes.POST, tenants.a.users.OWNER, body, randomUUID());
    expect(JSON.parse(second.text).id).not.toBe(JSON.parse(first.text).id);
    expect(second.response.headers.get("Idempotency-Replayed")).toBeNull();
    expect(await countReceipts(tenants.a.organizationId, q)).toBe(2);
  });

  it("the same key in another organization is independent", async () => {
    const key = randomUUID();
    const q = nextQuantity();
    const a = await receive(routes.POST, tenants.a.users.OWNER, bodyOf("a", q), key);
    const b = await receive(routes.POST, tenants.b.users.OWNER, bodyOf("b", q), key);
    expect(b.status).toBe(201);
    expect(b.response.headers.get("Idempotency-Replayed")).toBeNull();
    expect(JSON.parse(b.text).id).not.toBe(JSON.parse(a.text).id);
    expect(await countReceipts(tenants.a.organizationId, q)).toBe(1);
    expect(await countReceipts(tenants.b.organizationId, q)).toBe(1);
  });

  it("a key written in capitals is the same key", async () => {
    const key = randomUUID();
    const q = nextQuantity();
    await receive(routes.POST, tenants.a.users.OWNER, bodyOf("a", q), key);
    const again = await receive(
      routes.POST,
      tenants.a.users.OWNER,
      bodyOf("a", q),
      key.toUpperCase(),
    );
    expect(again.response.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await countReceipts(tenants.a.organizationId, q)).toBe(1);
  });

  it("a missing key or a key that is not a UUID gives 400 and no effect", async () => {
    const q = nextQuantity();
    for (const key of [null, "not-a-uuid"]) {
      const reply = await receive(routes.POST, tenants.a.users.OWNER, bodyOf("a", q), key);
      expect(reply.status).toBe(400);
      expect(JSON.parse(reply.text).code).toBe("VALIDATION_ERROR");
    }
    expect(await countReceipts(tenants.a.organizationId, q)).toBe(0);
  });

  it("a failed request leaves no key, so the retry runs again", async () => {
    const key = randomUUID();
    const q = nextQuantity();
    const unknownProduct = { ...bodyOf("a", q), productId: randomUUID() };
    const failed = await receive(routes.POST, tenants.a.users.OWNER, unknownProduct, key);
    expect(failed.status).toBe(404);
    const retry = await receive(routes.POST, tenants.a.users.OWNER, bodyOf("a", q), key);
    expect(retry.status).toBe(201);
    expect(retry.response.headers.get("Idempotency-Replayed")).toBeNull();
  });
});

describe("a replay is authorized like the original request", () => {
  it("a Viewer with a key that already exists gets 403, not the replay", async () => {
    const key = randomUUID();
    const q = nextQuantity();
    await receive(routes.POST, tenants.a.users.OWNER, bodyOf("a", q), key);
    const viewer = await receive(routes.POST, tenants.a.users.VIEWER, bodyOf("a", q), key);
    expect(viewer.status).toBe(403);
    expect(JSON.parse(viewer.text).code).toBe("FORBIDDEN");
    expect(viewer.response.headers.get("Idempotency-Replayed")).toBeNull();
  });

  it("a Warehouse Admin of another warehouse who uses the key of this one gets the 404 of a missing row", async () => {
    const key = randomUUID();
    const q = nextQuantity();
    const first = await receive(routes.POST, tenants.a.users.WAREHOUSE_ADMIN, bodyOf("a", q), key);
    expect(first.status).toBe(201);
    // The admin of W3 is allowed to receive into W3, so authorize() passes; only the replay check
    // can stop the answer from carrying the W1 receipt.
    const intruder = await receive(routes.POST, adminOfW3, bodyOf("a", q, warehouse3), key);
    expect(intruder.status).toBe(404);
    expect(intruder.text).toBe(await notFoundError().toResponse().text());
    expect(intruder.text).not.toContain(JSON.parse(first.text).id);
    expect(await countReceipts(tenants.a.organizationId, q)).toBe(1);
  });
});

describe("two requests with the same key at the same time", () => {
  it("produce one effect; the other one replays it", async () => {
    const key = randomUUID();
    const q = nextQuantity();
    const owner = tenants.a.users.OWNER;
    const [x, y] = await Promise.all([
      receive(slowRoutes.POST, owner, bodyOf("a", q), key),
      receive(slowRoutes.POST, owner, bodyOf("a", q), key),
    ]);
    expect([x.status, y.status]).toEqual([201, 201]);
    expect(JSON.parse(x.text).id).toBe(JSON.parse(y.text).id);
    expect(await countReceipts(tenants.a.organizationId, q)).toBe(1);
    const replays = [x, y].filter((r) => r.response.headers.get("Idempotency-Replayed") === "true");
    expect(replays).toHaveLength(1);
    expect(x.text).toBe(y.text);
  });

  it("five at once still produce one effect", async () => {
    const key = randomUUID();
    const q = nextQuantity();
    const owner = tenants.a.users.OWNER;
    const replies = await Promise.all(
      Array.from({ length: 5 }, () => receive(slowRoutes.POST, owner, bodyOf("a", q), key)),
    );
    expect(replies.every((r) => r.status === 201)).toBe(true);
    expect(new Set(replies.map((r) => JSON.parse(r.text).id)).size).toBe(1);
    expect(await countReceipts(tenants.a.organizationId, q)).toBe(1);
  });
});

describe("runIdempotent", () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  function clientOf(t: "a" | "b") {
    return createTenantClient(tenants.prisma, {
      userId: tenants[t].users.OWNER,
      organizationId: tenants[t].organizationId,
      role: "OWNER",
      warehouseIds: [tenants[t].warehouseId],
    });
  }
  const accessOf = (t: "a" | "b") => ({
    ctx: {
      userId: tenants[t].users.OWNER,
      organizationId: tenants[t].organizationId,
      role: "OWNER" as const,
      warehouseIds: [tenants[t].warehouseId],
    },
    action: "stock.receive" as const,
    warehouseIdOf: (row: { warehouseId: string }) => row.warehouseId,
  });
  const receiptWork = (t: "a" | "b", q: number) => async (tx: TenantTransaction) =>
    (
      await tx.stockMovement.create({
        data: {
          organizationId: tenants[t].organizationId,
          warehouseId: tenants[t].warehouseId,
          productId: tenants[t].productId,
          quantityDelta: q,
          type: "RECEIVE",
          createdById: tenants[t].users.OWNER,
        },
      })
    ).id;
  const loadRow = async (db: TenantClient, id: string) =>
    db.stockMovement.findFirstOrThrow({ where: { id } });

  it("the same key on another endpoint is independent", async () => {
    const db = clientOf("a");
    const key = randomUUID();
    const q = nextQuantity();
    const run = { work: receiptWork("a", q), load: loadRow, access: accessOf("a") };
    const first = await runIdempotent(db, { key, endpoint: "POST /api/x" }, run);
    const other = await runIdempotent(db, { key, endpoint: "POST /api/y" }, run);
    expect(first.replayed).toBe(false);
    expect(other.replayed).toBe(false);
    expect(await countReceipts(tenants.a.organizationId, q)).toBe(2);
  });

  it("a genuine error with no stored key is thrown as it was", async () => {
    const db = clientOf("a");
    const failure = new ApiError(409, ERROR_CODES.INSUFFICIENT_STOCK, "Stok tidak mencukupi.");
    const run = {
      work: async () => {
        throw failure;
      },
      load: loadRow,
      access: accessOf("a"),
    };
    await expect(
      runIdempotent(db, { key: randomUUID(), endpoint: "POST /api/x" }, run),
    ).rejects.toBe(failure);
  });

  it("a twin that fails its business rule after the first one committed still replays", async () => {
    const db = clientOf("a");
    const key = randomUUID();
    const scope = { key, endpoint: "POST /api/x" };
    const q = nextQuantity();
    const first = runIdempotent(db, scope, {
      work: async (tx) => {
        const id = await receiptWork("a", q)(tx);
        await sleep(150);
        return id;
      },
      load: loadRow,
      access: accessOf("a"),
    });
    await sleep(40); // the second request passes the pre-check while the first has not committed
    const second = runIdempotent(db, scope, {
      work: async () => {
        await first; // sees the committed effect of the first, then fails like INSUFFICIENT_STOCK
        throw new ApiError(409, ERROR_CODES.INSUFFICIENT_STOCK, "Stok tidak mencukupi.");
      },
      load: loadRow,
      access: accessOf("a"),
    });
    const [a, b] = await Promise.all([first, second]);
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(true);
    expect(b.result.id).toBe(a.result.id);
    expect(await countReceipts(tenants.a.organizationId, q)).toBe(1);
  });
});
