import { describe, expect, it } from "vitest";
import { EXEMPT_ROUTES, PUBLIC_ROUTES } from "./exemptions";
import {
  allowedRolesProblems,
  inventoryProblems,
  loadRoutes,
  type InventoryInput,
  type RouteInfo,
} from "./inventory";
import { TENANT_ENDPOINTS, rolesFor } from "./registry";

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
