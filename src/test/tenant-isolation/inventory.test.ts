import { describe, expect, it } from "vitest";
import { EXEMPT_ROUTES, IDEMPOTENCY_EXEMPT, PUBLIC_ROUTES } from "./exemptions";
import {
  allowedRolesProblems,
  foreignKeyProblems,
  idempotencyProblems,
  inventoryProblems,
  loadRoutes,
  type InventoryInput,
  type RouteInfo,
} from "./inventory";
import { TENANT_ENDPOINTS, rolesFor } from "./registry";

// Ids shaped like UUIDs, so a body(t) can be read without a database.
const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const fakeTenants = {
  a: { warehouseId: id(1), productId: id(2), organizationId: id(3) },
  b: { warehouseId: id(4), productId: id(5), organizationId: id(6) },
  unique: (prefix: string) => `${prefix}-1`,
};

// CI gate: no route.ts without a decision about its cross-tenant test.
describe("route inventory (real routes)", () => {
  it("lists every route.ts in exactly one of registry, EXEMPT_ROUTES and PUBLIC_ROUTES", async () => {
    const routes = await loadRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(5);
    const problems = inventoryProblems({
      routes,
      registered: TENANT_ENDPOINTS.map((e) => ({ route: e.route, method: e.method })),
      exempt: EXEMPT_ROUTES,
      publicRoutes: PUBLIC_ROUTES,
    });
    expect(problems).toEqual([]);
  });

  it("derives every allowedRoles from can() through rolesFor(action)", () => {
    expect(allowedRolesProblems(TENANT_ENDPOINTS, rolesFor)).toEqual([]);
  });

  it("marks every stock write endpoint idempotent: true, or lists it with a reason", () => {
    expect(idempotencyProblems(TENANT_ENDPOINTS, IDEMPOTENCY_EXEMPT)).toEqual([]);
  });

  it("gives every id key in the body of a stock write its own foreignBodies variant", () => {
    expect(foreignKeyProblems(TENANT_ENDPOINTS, fakeTenants)).toEqual([]);
  });

  it("registers each endpoint once and with a name that says its method and route", () => {
    const names = TENANT_ENDPOINTS.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    for (const endpoint of TENANT_ENDPOINTS) {
      expect(
        endpoint.allowedRoles.length,
        `${endpoint.name}: allowedRoles is empty`,
      ).toBeGreaterThan(0);
      expect(endpoint.name.startsWith(`${endpoint.method} `), endpoint.name).toBe(true);
    }
  });
});

// The inventory logic itself, on made-up routes: each rule must be able to fail.
describe("inventoryProblems (synthetic routes)", () => {
  const tenantRoute: RouteInfo = { key: "warehouses", isTenant: true, methods: ["GET", "POST"] };
  const publicRoute: RouteInfo = { key: "health", isTenant: false, methods: ["GET"] };
  const base: InventoryInput = {
    routes: [tenantRoute, publicRoute],
    registered: [
      { route: "warehouses", method: "GET" },
      { route: "warehouses", method: "POST" },
    ],
    exempt: {},
    publicRoutes: { health: "no tenant data" },
  };

  it("accepts a complete inventory", () => {
    expect(inventoryProblems(base)).toEqual([]);
  });

  it("fails a route that is in no list", () => {
    const problems = inventoryProblems({ ...base, publicRoutes: {} });
    expect(problems).toEqual([expect.stringContaining('"health" is in no list')]);
  });

  it("fails a route that is in two lists", () => {
    const problems = inventoryProblems({ ...base, exempt: { warehouses: "because" } });
    expect(problems).toEqual([
      expect.stringContaining("more than one list: the registry, EXEMPT_ROUTES"),
    ]);
  });

  it("fails an entry that points to a route that does not exist", () => {
    expect(inventoryProblems({ ...base, exempt: { ghost: "gone" } })).toEqual([
      expect.stringContaining('EXEMPT_ROUTES names "ghost"'),
    ]);
    expect(
      inventoryProblems({ ...base, publicRoutes: { ...base.publicRoutes, ghost: "gone" } }),
    ).toEqual([expect.stringContaining('PUBLIC_ROUTES names "ghost"')]);
    expect(
      inventoryProblems({
        ...base,
        registered: [...base.registered, { route: "ghost", method: "GET" }],
      }),
    ).toEqual([expect.stringContaining('the registry names "ghost"')]);
  });

  it("fails a tenant route listed as public, and a public route listed as tenant", () => {
    const leaking = inventoryProblems({
      ...base,
      registered: [],
      publicRoutes: { health: "ok", warehouses: "oops" },
    });
    expect(leaking).toEqual([expect.stringContaining('"warehouses" uses withTenantRoute')]);
    const wrong = inventoryProblems({
      ...base,
      routes: [tenantRoute, { ...publicRoute, isTenant: false }],
      publicRoutes: {},
      exempt: { health: "not tenant" },
    });
    expect(wrong).toEqual([expect.stringContaining('"health" does not use withTenantRoute')]);
  });

  it("fails a registered route with an exported method that has no entry", () => {
    const problems = inventoryProblems({
      ...base,
      registered: [{ route: "warehouses", method: "GET" }],
    });
    expect(problems).toEqual([
      expect.stringContaining("exports POST, but the registry has no POST entry"),
    ]);
  });

  it("fails an exemption without a reason", () => {
    const problems = inventoryProblems({
      ...base,
      registered: [],
      exempt: { warehouses: " " },
    });
    expect(problems).toEqual([expect.stringContaining('EXEMPT_ROUTES "warehouses" has no reason')]);
  });
});

describe("rolesFor", () => {
  it("follows the permission table", () => {
    expect(rolesFor("warehouse.read")).toEqual(["OWNER", "WAREHOUSE_ADMIN", "VIEWER"]);
    expect(rolesFor("warehouse.manage")).toEqual(["OWNER"]);
    expect(rolesFor("member.manage")).toEqual(["OWNER"]);
  });

  it("judges a warehouse-level action for an assigned warehouse", () => {
    expect(rolesFor("stock.read")).toEqual(["OWNER", "WAREHOUSE_ADMIN", "VIEWER"]);
    expect(rolesFor("stock.receive")).toEqual(["OWNER", "WAREHOUSE_ADMIN"]);
    expect(rolesFor("stock.transfer")).toEqual(["OWNER", "WAREHOUSE_ADMIN"]);
  });
});

describe("allowedRolesProblems (synthetic entries)", () => {
  const entry = (allowedRoles: string[]) => ({
    name: "PATCH /api/x/[id]",
    action: "warehouse.manage" as const,
    allowedRoles,
  });

  it("accepts the roles that rolesFor gives, in any order", () => {
    expect(allowedRolesProblems([entry(["OWNER"])], rolesFor)).toEqual([]);
  });

  it("fails a role list that is too wide or too narrow", () => {
    expect(allowedRolesProblems([entry(["OWNER", "VIEWER"])], rolesFor)).toEqual([
      expect.stringContaining('differs from rolesFor("warehouse.manage") [OWNER]'),
    ]);
    expect(allowedRolesProblems([entry([])], rolesFor)).toHaveLength(1);
  });
});

describe("idempotencyProblems (synthetic entries)", () => {
  const write = (route: string, extra: { idempotent?: true } = {}) => ({
    name: `POST /api/${route}`,
    route,
    method: "POST",
    ...extra,
  });

  it("accepts stock writes that are idempotent, and writes elsewhere that are not", () => {
    const entries = [write("stock/receive", { idempotent: true }), write("warehouses")];
    expect(idempotencyProblems(entries, {})).toEqual([]);
  });

  it("fails a write under stock/, transfers or imports that is not idempotent", () => {
    for (const route of ["stock/receive", "stock/transfers", "transfers/[id]/cancel", "imports"]) {
      expect(idempotencyProblems([write(route)], {}), route).toEqual([
        expect.stringContaining("must be idempotent: true"),
      ]);
    }
  });

  it("does not ask a read for a key, and fails idempotent set on a read", () => {
    const read = { name: "GET /api/stock", route: "stock/x", method: "GET" };
    expect(idempotencyProblems([read], {})).toEqual([]);
    expect(idempotencyProblems([{ ...read, idempotent: true }], {})).toEqual([
      expect.stringContaining("idempotent is set on a GET"),
    ]);
  });

  it("accepts a listed exemption, and fails one without a reason", () => {
    const entry = write("imports");
    expect(idempotencyProblems([entry], { "POST /api/imports": "preview only" })).toEqual([]);
    expect(idempotencyProblems([entry], { "POST /api/imports": " " })).toEqual([
      expect.stringContaining('IDEMPOTENCY_EXEMPT "POST /api/imports" has no reason'),
    ]);
  });
});

describe("foreignKeyProblems (synthetic entries)", () => {
  type T = typeof fakeTenants;
  const missingId = id(99);
  const entry = (
    foreignBodies?: (t: T) => { name: string; body: unknown; missingBody: unknown }[],
    route = "stock/receive",
  ) => ({
    name: `POST /api/${route}`,
    route,
    method: "POST",
    body: (t: T) => ({ warehouseId: t.a.warehouseId, productId: t.a.productId, quantity: 1 }),
    foreignBodies: foreignBodies as never,
  });
  const both = (t: T) => [
    {
      name: "warehouse of B",
      body: { warehouseId: t.b.warehouseId, productId: t.a.productId, quantity: 1 },
      missingBody: { warehouseId: missingId, productId: t.a.productId, quantity: 1 },
    },
    {
      name: "product of B",
      body: { warehouseId: t.a.warehouseId, productId: t.b.productId, quantity: 1 },
      missingBody: { warehouseId: t.a.warehouseId, productId: missingId, quantity: 1 },
    },
  ];

  it("accepts an entry with one variant per id key", () => {
    expect(foreignKeyProblems([entry(both)], fakeTenants)).toEqual([]);
  });

  it("fails an entry without foreignBodies", () => {
    expect(foreignKeyProblems([entry()], fakeTenants)).toEqual([
      expect.stringContaining("has no foreignBodies"),
    ]);
  });

  it("fails an id key that has no variant", () => {
    expect(foreignKeyProblems([entry((t) => [both(t)[0]])], fakeTenants)).toEqual([
      expect.stringContaining('the id key "productId" has no foreignBodies variant'),
    ]);
  });

  it("fails a variant that changes more than one key, or the wrong key in missingBody", () => {
    const twoKeys = (t: T) => [
      {
        name: "both of B",
        body: { warehouseId: t.b.warehouseId, productId: t.b.productId, quantity: 1 },
        missingBody: { warehouseId: missingId, productId: missingId, quantity: 1 },
      },
    ];
    expect(foreignKeyProblems([entry(twoKeys)], fakeTenants)[0]).toContain(
      "must replace exactly one id key",
    );
    const wrongMissing = (t: T) => [
      {
        ...both(t)[0],
        missingBody: { warehouseId: t.a.warehouseId, productId: missingId, quantity: 1 },
      },
      both(t)[1],
    ];
    expect(foreignKeyProblems([entry(wrongMissing)], fakeTenants)[0]).toContain(
      'the missingBody of "warehouse of B" must replace exactly "warehouseId"',
    );
  });

  it("ignores reads and writes outside stock/, transfers and imports", () => {
    expect(foreignKeyProblems([entry(undefined, "warehouses")], fakeTenants)).toEqual([]);
    expect(foreignKeyProblems([{ ...entry(), method: "GET" }], fakeTenants)).toEqual([]);
  });
});
