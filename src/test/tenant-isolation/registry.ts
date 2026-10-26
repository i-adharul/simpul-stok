import type { PrismaClient } from "../../generated/prisma/client";
import { can, type Action } from "../../modules/platform/can";
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

// POST /api/x that creates a row in the caller's organization.
export type CreateEndpoint = Common & {
  kind: "create";
  method: "POST";
  path: string;
  body: (tenants: TwoTenants) => unknown;
  // Counts the rows of one organization, to prove a create lands in the right one (or nowhere).
  countRows: (prisma: PrismaClient, organizationId: string) => Promise<number>;
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

export const TENANT_ENDPOINTS: TenantEndpoint[] = [
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
];
