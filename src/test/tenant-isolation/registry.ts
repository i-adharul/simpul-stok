import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client";
import { can, type Action } from "../../modules/platform/can";
import { encodeMovementCursor } from "../../modules/stock/stock-schema";
import { TENANT_ROLES, type TenantKey, type TenantRole, type TwoTenants } from "./fixtures";

// The registry of tenant endpoints (BL03). Every route under src/app/api that uses withTenantRoute is
// registered here, or listed with a reason in exemptions.ts; inventory.test.ts fails CI otherwise.
// How to add one: src/test/README.md.
//
// One entry = one HTTP method of one route. The harness (run-harness.ts) then tries it from
// organization A against organization B's data.

// The tenant roles that the permission rules (can.ts, docs/02 "Roles and permissions") allow to do
// `action`. A warehouse-level action is judged for a warehouse the user is assigned to. Registry entries
// use this for allowedRoles instead of a hand-written list, and inventory.test.ts fails an entry that
// differs, so the harness can never test against a role list that disagrees with can().
export function rolesFor(action: Action): TenantRole[] {
  const warehouseId = "warehouse-in-scope";
  return TENANT_ROLES.filter((role) =>
    can({ userId: "u", organizationId: "o", role, warehouseIds: [warehouseId] }, action, {
      warehouseId,
    }),
  );
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type RouteModule = Record<string, unknown>;

// What readRow returns: the columns the endpoint could change, plus organizationId.
export type RowSnapshot = { organizationId: string } & Record<string, unknown>;

type Common = {
  // Shown in test names, for example "PATCH /api/warehouses/[id]".
  name: string;
  // The route folder below src/app/api, the same key as in exemptions.ts: "warehouses/[id]".
  route: string;
  method: HttpMethod;
  // () => import("@/app/api/warehouses/[id]/route"). Lazy so a broken route fails its own tests.
  module: () => Promise<RouteModule>;
  // The permission the endpoint enforces (can.ts). For an organization-level action the route passes it
  // as `requires` to withTenantRoute, so the role is checked before the input is validated.
  action: Action;
  // Always rolesFor(action). Every other tenant role must get 403, before the existence of the row is
  // checked.
  allowedRoles: readonly TenantRole[];
  // true when the route is built with withTenantRoute({ idempotent: true }) (BL14, ADR 0012). The
  // harness then proves a write without a valid Idempotency-Key gets 400, and sends a fresh key on
  // every other request. inventory.test.ts requires it on every stock write endpoint.
  idempotent?: true;
};

// An endpoint addressed by the ID of one row: GET/PATCH/PUT/DELETE /api/x/[id], POST /api/x/[id]/cancel.
export type ItemEndpoint = Common & {
  kind: "item";
  // Name of the dynamic segment, for the Route Handler context: "id".
  idParam: string;
  // The URL for that row, for example (id) => `/api/warehouses/${id}`.
  path: (id: string) => string;
  // A VALID body for a write method (the harness must reach the handler, not the validation).
  body?: (tenants: TwoTenants) => unknown;
  // Creates one row that belongs to the given organization and returns its ID.
  createRow: (tenants: TwoTenants, owner: TenantKey) => Promise<string>;
  // Reads the row with the plain client (null when it does not exist), to prove it was not changed.
  readRow: (prisma: PrismaClient, id: string) => Promise<RowSnapshot | null>;
};

// GET /api/x. The harness checks it contains none of B's rows.
export type ListEndpoint = Common & {
  kind: "list";
  method: "GET";
  path: string;
  createRow: (tenants: TwoTenants, owner: TenantKey) => Promise<string>;
  // Pulls the row IDs out of the parsed JSON response.
  idsOf: (json: unknown) => string[];
  // true when the list accepts a cursor: the harness sends a cursor that holds B's row ID.
  supportsCursor?: boolean;
  // Builds the cursor query value for a row ID. Defaults to the ID itself.
  encodeCursor?: (id: string) => string;
};

// One request body that carries exactly ONE foreign key of organization B (the rest is valid for A),
// next to the same body with a random UUID in its place. The harness requires the two answers to be
// byte-identical, with the status the registry states: 403 when the service authorizes the key first
// (a warehouse, judged against ctx.warehouseIds), 404 when it looks the key up (a product).
export type ForeignBody = {
  name: string;
  body: unknown;
  missingBody: unknown;
  status: 403 | 404;
};

// POST /api/x that creates a row in the caller's organization.
export type CreateEndpoint = Common & {
  kind: "create";
  method: "POST";
  path: string;
  body: (tenants: TwoTenants) => unknown;
  // Counts the rows of one organization, to prove a create lands in the right one (or nowhere).
  countRows: (prisma: PrismaClient, organizationId: string) => Promise<number>;
  // Optional: a body for each foreign key the endpoint takes (a destination warehouse, a product).
  // E5 transfers reuse it for the destination warehouse.
  foreignBodies?: (tenants: TwoTenants) => ForeignBody[];
  // Optional: the state the endpoint could change that countRows does not see (for example the stock
  // quantity of a (warehouse, product) pair in both organizations), to prove nothing was written.
  readRow?: (prisma: PrismaClient, tenants: TwoTenants) => Promise<Record<string, unknown>>;
  // Optional: puts the data in place that makes the valid body succeed (for example enough stock at the
  // source of a transfer). Must be idempotent: the harness runs it before every request.
  arrange?: (tenants: TwoTenants) => Promise<void>;
};

export type TenantEndpoint = ItemEndpoint | ListEndpoint | CreateEndpoint;

// Warehouse rows for the registry entries below. Codes must be unique per organization and uppercase.
const createWarehouseRow = async (t: TwoTenants, owner: TenantKey) =>
  (
    await t.prisma.warehouse.create({
      data: {
        organizationId: t[owner].organizationId,
        code: t.unique("ROW").toUpperCase(),
        name: `row of ${owner}`,
      },
    })
  ).id;

// The list only shows a Warehouse Admin or Viewer their assigned warehouses, so the row the harness
// expects to see is also assigned to both of them.
const createAssignedWarehouseRow = async (t: TwoTenants, owner: TenantKey) => {
  const id = await createWarehouseRow(t, owner);
  for (const role of ["WAREHOUSE_ADMIN", "VIEWER"] as const) {
    await t.prisma.userWarehouse.create({
      data: {
        organizationId: t[owner].organizationId,
        userId: t[owner].users[role],
        warehouseId: id,
      },
    });
  }
  return id;
};

// Every column PATCH can change (code, name, address), plus organizationId and archivedAt.
const readWarehouseRow = async (prisma: PrismaClient, id: string): Promise<RowSnapshot | null> => {
  const row = await prisma.warehouse.findUnique({ where: { id } });
  return (
    row && {
      organizationId: row.organizationId,
      code: row.code,
      name: row.name,
      address: row.address,
      archivedAt: row.archivedAt,
    }
  );
};

const warehouseItem = {
  kind: "item" as const,
  route: "warehouses/[id]",
  module: () => import("@/app/api/warehouses/[id]/route"),
  idParam: "id",
  path: (id: string) => `/api/warehouses/${id}`,
  createRow: createWarehouseRow,
  readRow: readWarehouseRow,
};

// The only state PUT .../members can change: the set of users assigned to the warehouse (sorted).
const readWarehouseMembersRow = async (
  prisma: PrismaClient,
  id: string,
): Promise<RowSnapshot | null> => {
  const row = await prisma.warehouse.findUnique({ where: { id } });
  if (!row) return null;
  const assigned = await prisma.userWarehouse.findMany({
    where: { warehouseId: id },
    select: { userId: true },
  });
  return {
    organizationId: row.organizationId,
    userIds: assigned.map((a) => a.userId).sort(),
  };
};

const warehouseMembersItem = {
  ...warehouseItem,
  route: "warehouses/[id]/members",
  module: () => import("@/app/api/warehouses/[id]/members/route"),
  path: (id: string) => `/api/warehouses/${id}/members`,
  readRow: readWarehouseMembersRow,
};

// Product rows for the registry entries below. SKUs must be unique per organization, uppercase, no spaces.
const createProductRow = async (t: TwoTenants, owner: TenantKey) =>
  (
    await t.prisma.product.create({
      data: {
        organizationId: t[owner].organizationId,
        sku: t.unique("ROW").toUpperCase().replace(/\s+/g, ""),
        name: `row of ${owner}`,
        unit: "pcs",
      },
    })
  ).id;

// Every column PATCH can change (sku, name, unit, minStock, archivedAt), plus organizationId.
const readProductRow = async (prisma: PrismaClient, id: string): Promise<RowSnapshot | null> => {
  const row = await prisma.product.findUnique({ where: { id } });
  return (
    row && {
      organizationId: row.organizationId,
      sku: row.sku,
      name: row.name,
      unit: row.unit,
      minStock: row.minStock,
      archivedAt: row.archivedAt,
    }
  );
};

const productItem = {
  kind: "item" as const,
  route: "products/[id]",
  module: () => import("@/app/api/products/[id]/route"),
  idParam: "id",
  path: (id: string) => `/api/products/${id}`,
  createRow: createProductRow,
  readRow: readProductRow,
};

// The stock quantity of each organization's (warehouse, product) pair; null when no row exists yet.
const readStockPairs = async (prisma: PrismaClient, t: TwoTenants) => {
  const quantityOf = async (tenant: TwoTenants["a"]) =>
    (
      await prisma.stockLevel.findUnique({
        where: {
          warehouseId_productId: { warehouseId: tenant.warehouseId, productId: tenant.productId },
        },
      })
    )?.quantity ?? null;
  return { a: await quantityOf(t.a), b: await quantityOf(t.b) };
};

// The stock of the transfer pair: product of each organization in both of its warehouses.
const readTransferPairs = async (prisma: PrismaClient, t: TwoTenants) => {
  const quantityOf = async (warehouseId: string, productId: string) =>
    (
      await prisma.stockLevel.findUnique({
        where: { warehouseId_productId: { warehouseId, productId } },
      })
    )?.quantity ?? null;
  const snapshot: Record<string, number | null> = {};
  for (const key of ["a", "b"] as const) {
    snapshot[`${key}:source`] = await quantityOf(t[key].warehouseId, t[key].productId);
    snapshot[`${key}:destination`] = await quantityOf(t[key].secondWarehouseId, t[key].productId);
  }
  return snapshot;
};

// The source of a transfer needs stock for the valid body to succeed. Setting (not adding) keeps this
// idempotent, so the harness can run it before every request.
const arrangeTransferStock = async (t: TwoTenants) => {
  await t.prisma.stockLevel.upsert({
    where: { warehouseId_productId: { warehouseId: t.a.warehouseId, productId: t.a.productId } },
    create: {
      organizationId: t.a.organizationId,
      warehouseId: t.a.warehouseId,
      productId: t.a.productId,
      quantity: 1000,
    },
    update: { quantity: 1000 },
  });
};

const transferBody = (
  t: TwoTenants,
  overrides: { fromWarehouseId?: string; toWarehouseId?: string; productId?: string } = {},
) => ({
  fromWarehouseId: overrides.fromWarehouseId ?? t.a.warehouseId,
  toWarehouseId: overrides.toWarehouseId ?? t.a.secondWarehouseId,
  items: [{ productId: overrides.productId ?? t.a.productId, quantity: 2 }],
});

// A history row in the organization's own warehouse (assigned to every role) and product.
const createMovementRow = async (t: TwoTenants, owner: TenantKey) =>
  (
    await t.prisma.stockMovement.create({
      data: {
        organizationId: t[owner].organizationId,
        warehouseId: t[owner].warehouseId,
        productId: t[owner].productId,
        quantityDelta: 1,
        type: "RECEIVE",
        createdById: t[owner].users.OWNER,
      },
    })
  ).id;

// History rows are immutable (rule 8), so the snapshot is every column.
const readMovementRow = async (prisma: PrismaClient, id: string): Promise<RowSnapshot | null> => {
  const row = await prisma.stockMovement.findUnique({ where: { id } });
  return row && { ...row };
};

// A transfer between the organization's two warehouses (W1 is assigned to every role). Immutable data,
// so the snapshot is every column.
const createTransferRow = async (t: TwoTenants, owner: TenantKey) =>
  (
    await t.prisma.stockTransfer.create({
      data: {
        organizationId: t[owner].organizationId,
        code: t.unique("MT"),
        fromWarehouseId: t[owner].warehouseId,
        toWarehouseId: t[owner].secondWarehouseId,
        createdById: t[owner].users.OWNER,
      },
    })
  ).id;

const readTransferRow = async (prisma: PrismaClient, id: string): Promise<RowSnapshot | null> => {
  const row = await prisma.stockTransfer.findUnique({ where: { id } });
  return row && { ...row };
};

// A stock row in the organization's own warehouse (assigned to every role) for a fresh product. The id
// has the form warehouseId:productId, as the response holds no single row id.
const createStockLevelRow = async (t: TwoTenants, owner: TenantKey) => {
  const organizationId = t[owner].organizationId;
  const product = await t.prisma.product.create({
    data: { organizationId, sku: t.unique("STK").toUpperCase(), name: "stock row", unit: "pcs" },
  });
  await t.prisma.stockLevel.create({
    data: { organizationId, warehouseId: t[owner].warehouseId, productId: product.id, quantity: 1 },
  });
  return `${t[owner].warehouseId}:${product.id}`;
};

export const TENANT_ENDPOINTS: TenantEndpoint[] = [
  {
    kind: "list",
    name: "GET /api/stock",
    route: "stock",
    method: "GET",
    module: () => import("@/app/api/stock/route"),
    action: "stock.read",
    allowedRoles: rolesFor("stock.read"),
    path: "/api/stock",
    createRow: createStockLevelRow,
    idsOf: (json) =>
      (json as { items: { warehouse: { id: string }; product: { id: string } }[] }).items.map(
        (row) => `${row.warehouse.id}:${row.product.id}`,
      ),
  },
  {
    kind: "list",
    name: "GET /api/dashboard",
    route: "dashboard",
    method: "GET",
    module: () => import("@/app/api/dashboard/route"),
    action: "stock.read",
    allowedRoles: rolesFor("stock.read"),
    path: "/api/dashboard",
    createRow: createMovementRow,
    // The only rows the dashboard lists are the latest movements.
    idsOf: (json) => (json as { recentActivity: { id: string }[] }).recentActivity.map((r) => r.id),
  },
  {
    kind: "item",
    name: "GET /api/stock/movements/[id]",
    route: "stock/movements/[id]",
    method: "GET",
    module: () => import("@/app/api/stock/movements/[id]/route"),
    action: "history.read",
    allowedRoles: rolesFor("history.read"),
    idParam: "id",
    path: (id: string) => `/api/stock/movements/${id}`,
    createRow: createMovementRow,
    readRow: readMovementRow,
  },
  {
    kind: "list",
    name: "GET /api/stock/movements",
    route: "stock/movements",
    method: "GET",
    module: () => import("@/app/api/stock/movements/route"),
    action: "history.read",
    allowedRoles: rolesFor("history.read"),
    path: "/api/stock/movements",
    createRow: createMovementRow,
    idsOf: (json) => (json as { items: { id: string }[] }).items.map((row) => row.id),
    supportsCursor: true,
    encodeCursor: (id) => encodeMovementCursor({ createdAt: new Date(), id }),
  },
  {
    kind: "item",
    name: "GET /api/stock/transfers/[id]",
    route: "stock/transfers/[id]",
    method: "GET",
    module: () => import("@/app/api/stock/transfers/[id]/route"),
    action: "history.read",
    allowedRoles: rolesFor("history.read"),
    idParam: "id",
    path: (id: string) => `/api/stock/transfers/${id}`,
    createRow: createTransferRow,
    readRow: readTransferRow,
  },
  {
    kind: "list",
    name: "GET /api/warehouses",
    route: "warehouses",
    method: "GET",
    module: () => import("@/app/api/warehouses/route"),
    action: "warehouse.read",
    allowedRoles: rolesFor("warehouse.read"),
    path: "/api/warehouses",
    createRow: createAssignedWarehouseRow,
    idsOf: (json) => (json as { items: { id: string }[] }).items.map((row) => row.id),
  },
  {
    kind: "create",
    name: "POST /api/warehouses",
    route: "warehouses",
    method: "POST",
    module: () => import("@/app/api/warehouses/route"),
    action: "warehouse.manage",
    allowedRoles: rolesFor("warehouse.manage"),
    path: "/api/warehouses",
    body: (t) => ({ code: t.unique("NEW"), name: "New warehouse", address: "Jl. Baru 1" }),
    countRows: (prisma, organizationId) => prisma.warehouse.count({ where: { organizationId } }),
  },
  {
    ...warehouseItem,
    name: "GET /api/warehouses/[id]",
    method: "GET",
    action: "warehouse.read",
    allowedRoles: rolesFor("warehouse.read"),
  },
  {
    ...warehouseItem,
    name: "PATCH /api/warehouses/[id]",
    method: "PATCH",
    action: "warehouse.manage",
    allowedRoles: rolesFor("warehouse.manage"),
    body: (t) => ({ code: t.unique("EDIT"), name: "Renamed", address: "Jl. Ubah 2" }),
  },
  {
    ...warehouseMembersItem,
    name: "GET /api/warehouses/[id]/members",
    method: "GET",
    action: "member.manage",
    allowedRoles: rolesFor("member.manage"),
  },
  {
    ...warehouseMembersItem,
    name: "PUT /api/warehouses/[id]/members",
    method: "PUT",
    action: "member.manage",
    allowedRoles: rolesFor("member.manage"),
    body: (t) => ({ userIds: [t.a.users.VIEWER] }),
  },
  {
    kind: "list",
    name: "GET /api/products",
    route: "products",
    method: "GET",
    module: () => import("@/app/api/products/route"),
    action: "product.read",
    allowedRoles: rolesFor("product.read"),
    path: "/api/products",
    createRow: createProductRow,
    idsOf: (json) => (json as { items: { id: string }[] }).items.map((row) => row.id),
  },
  {
    kind: "create",
    name: "POST /api/products",
    route: "products",
    method: "POST",
    module: () => import("@/app/api/products/route"),
    action: "product.manage",
    allowedRoles: rolesFor("product.manage"),
    path: "/api/products",
    body: (t) => ({ sku: t.unique("NEW"), name: "New product", unit: "pcs", minStock: 5 }),
    countRows: (prisma, organizationId) => prisma.product.count({ where: { organizationId } }),
  },
  {
    ...productItem,
    name: "GET /api/products/[id]",
    method: "GET",
    action: "product.read",
    allowedRoles: rolesFor("product.read"),
  },
  {
    ...productItem,
    name: "PATCH /api/products/[id]",
    method: "PATCH",
    action: "product.manage",
    allowedRoles: rolesFor("product.manage"),
    body: (t) => ({ sku: t.unique("EDIT"), name: "Renamed", unit: "btl", minStock: 9 }),
  },
  {
    kind: "create",
    name: "POST /api/stock/receive",
    route: "stock/receive",
    method: "POST",
    module: () => import("@/app/api/stock/receive/route"),
    action: "stock.receive",
    allowedRoles: rolesFor("stock.receive"),
    idempotent: true,
    path: "/api/stock/receive",
    body: (t) => ({ warehouseId: t.a.warehouseId, productId: t.a.productId, quantity: 3 }),
    countRows: (prisma, organizationId) =>
      prisma.stockMovement.count({ where: { organizationId } }),
    readRow: readStockPairs,
    // The warehouse is authorized against ctx.warehouseIds first, so B's warehouse and a missing one
    // are both 403; a product is looked up, so B's product and a missing one are both 404.
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
  },
  {
    kind: "create",
    name: "POST /api/stock/adjust",
    route: "stock/adjust",
    method: "POST",
    module: () => import("@/app/api/stock/adjust/route"),
    action: "stock.adjust",
    allowedRoles: rolesFor("stock.adjust"),
    idempotent: true,
    path: "/api/stock/adjust",
    body: (t) => ({
      warehouseId: t.a.warehouseId,
      productId: t.a.productId,
      mode: "DELTA",
      value: 3,
      reason: "CORRECTION",
    }),
    countRows: (prisma, organizationId) =>
      prisma.stockMovement.count({ where: { organizationId } }),
    readRow: readStockPairs,
    // Same as receive: B's warehouse and a missing one are both 403; B's product and a missing one are 404.
    foreignBodies: (t) => [
      {
        name: "warehouse of B",
        body: {
          warehouseId: t.b.warehouseId,
          productId: t.a.productId,
          mode: "DELTA",
          value: 3,
          reason: "CORRECTION",
        },
        missingBody: {
          warehouseId: randomUUID(),
          productId: t.a.productId,
          mode: "DELTA",
          value: 3,
          reason: "CORRECTION",
        },
        status: 403,
      },
      {
        name: "product of B",
        body: {
          warehouseId: t.a.warehouseId,
          productId: t.b.productId,
          mode: "DELTA",
          value: 3,
          reason: "CORRECTION",
        },
        missingBody: {
          warehouseId: t.a.warehouseId,
          productId: randomUUID(),
          mode: "DELTA",
          value: 3,
          reason: "CORRECTION",
        },
        status: 404,
      },
    ],
  },
  {
    kind: "create",
    name: "POST /api/stock/transfers",
    route: "stock/transfers",
    method: "POST",
    module: () => import("@/app/api/stock/transfers/route"),
    action: "stock.transfer",
    allowedRoles: rolesFor("stock.transfer"),
    idempotent: true,
    path: "/api/stock/transfers",
    body: (t) => transferBody(t),
    countRows: (prisma, organizationId) =>
      prisma.stockTransfer.count({ where: { organizationId } }),
    readRow: readTransferPairs,
    arrange: arrangeTransferStock,
    // The source is authorized against ctx.warehouseIds first (403 for B's and a missing one); the
    // destination and the product are looked up (404 for B's and a missing one).
    foreignBodies: (t) => [
      {
        name: "source warehouse of B",
        body: transferBody(t, { fromWarehouseId: t.b.warehouseId }),
        missingBody: transferBody(t, { fromWarehouseId: randomUUID() }),
        status: 403,
      },
      {
        name: "destination warehouse of B",
        body: transferBody(t, { toWarehouseId: t.b.secondWarehouseId }),
        missingBody: transferBody(t, { toWarehouseId: randomUUID() }),
        status: 404,
      },
      {
        name: "product of B",
        body: transferBody(t, { productId: t.b.productId }),
        missingBody: transferBody(t, { productId: randomUUID() }),
        status: 404,
      },
    ],
  },
  {
    kind: "list",
    name: "GET /api/stock/transfers/destinations",
    route: "stock/transfers/destinations",
    method: "GET",
    module: () => import("@/app/api/stock/transfers/destinations/route"),
    action: "transfer.destinations",
    allowedRoles: rolesFor("transfer.destinations"),
    path: "/api/stock/transfers/destinations",
    // Not assigned to anyone: the list must still show it to a Warehouse Admin (BL13).
    createRow: createWarehouseRow,
    idsOf: (json) => (json as { items: { id: string }[] }).items.map((row) => row.id),
  },
];
