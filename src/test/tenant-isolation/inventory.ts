import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Action } from "../../modules/platform/can";
import { isTenantGuard } from "../../modules/platform/tenant-route";

// The route inventory (BL03). Deny by default: every route.ts under src/app/api must be in exactly ONE
// of the registry, EXEMPT_ROUTES or PUBLIC_ROUTES, so a new endpoint cannot ship without a decision
// about its cross-tenant test.

export const API_DIR = path.resolve(__dirname, "../../app/api");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export type RouteInfo = {
  // Folder below src/app/api, for example "warehouses/[id]".
  key: string;
  // true when the route uses withTenantRoute: seen in the source text, or in the loaded module (a
  // route that hides it behind a helper still carries the guard marker).
  isTenant: boolean;
  methods: string[];
};

export type InventoryInput = {
  routes: RouteInfo[];
  registered: { route: string; method: string }[];
  exempt: Record<string, string>;
  publicRoutes: Record<string, string>;
};

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

export async function loadRoutes(): Promise<RouteInfo[]> {
  const infos: RouteInfo[] = [];
  for (const file of routeFiles(API_DIR)) {
    const key = path.relative(API_DIR, path.dirname(file)).split(path.sep).join("/");
    const mod = (await import(file)) as Record<string, unknown>;
    const methods = METHODS.filter((method) => method in mod);
    const wrapped = methods.some((method) => {
      const route = mod[method] as { apiOptions?: { guard?: unknown } };
      return isTenantGuard(route.apiOptions?.guard);
    });
    infos.push({
      key,
      isTenant: wrapped || /\bwithTenantRoute\b/.test(readFileSync(file, "utf8")),
      methods,
    });
  }
  return infos.sort((x, y) => x.key.localeCompare(y.key));
}

// Returns one sentence per problem; an empty list means the inventory is complete and consistent.
export function inventoryProblems(input: InventoryInput): string[] {
  const problems: string[] = [];
  const known = new Set(input.routes.map((route) => route.key));
  const registeredRoutes = new Set(input.registered.map((entry) => entry.route));

  const lists: [string, Iterable<string>][] = [
    ["the registry", registeredRoutes],
    ["EXEMPT_ROUTES", Object.keys(input.exempt)],
    ["PUBLIC_ROUTES", Object.keys(input.publicRoutes)],
  ];
  for (const [listName, keys] of lists) {
    for (const key of keys) {
      if (!known.has(key))
        problems.push(`${listName} names "${key}", but there is no such route.ts`);
    }
  }
  for (const [listName, reasons] of [
    ["EXEMPT_ROUTES", input.exempt],
    ["PUBLIC_ROUTES", input.publicRoutes],
  ] as const) {
    for (const [key, reason] of Object.entries(reasons)) {
      if (reason.trim() === "") problems.push(`${listName} "${key}" has no reason`);
    }
  }

  for (const route of input.routes) {
    const where = [
      registeredRoutes.has(route.key) ? "the registry" : null,
      route.key in input.exempt ? "EXEMPT_ROUTES" : null,
      route.key in input.publicRoutes ? "PUBLIC_ROUTES" : null,
    ].filter((name) => name !== null);
    if (where.length === 0) {
      problems.push(
        `"${route.key}" is in no list: register it in registry.ts, or add it to EXEMPT_ROUTES / PUBLIC_ROUTES with a reason`,
      );
      continue;
    }
    if (where.length > 1)
      problems.push(`"${route.key}" is in more than one list: ${where.join(", ")}`);

    if (route.key in input.publicRoutes && route.isTenant) {
      problems.push(`"${route.key}" uses withTenantRoute, so it cannot be in PUBLIC_ROUTES`);
    }
    if ((registeredRoutes.has(route.key) || route.key in input.exempt) && !route.isTenant) {
      problems.push(`"${route.key}" does not use withTenantRoute, so it belongs in PUBLIC_ROUTES`);
    }
    if (registeredRoutes.has(route.key)) {
      for (const method of route.methods) {
        const found = input.registered.some((e) => e.route === route.key && e.method === method);
        if (!found)
          problems.push(
            `"${route.key}" exports ${method}, but the registry has no ${method} entry for it`,
          );
      }
    }
  }
  return problems;
}

// allowedRoles must be exactly what can() allows for the entry's action (rolesFor), so the harness
// cannot test against a role list that disagrees with the permission rules.
export function allowedRolesProblems(
  endpoints: { name: string; action: Action; allowedRoles: readonly string[] }[],
  rolesFor: (action: Action) => readonly string[],
): string[] {
  const problems: string[] = [];
  for (const endpoint of endpoints) {
    const expected = [...rolesFor(endpoint.action)].sort();
    const actual = [...endpoint.allowedRoles].sort();
    if (expected.join() !== actual.join()) {
      problems.push(
        `${endpoint.name}: allowedRoles [${actual}] differs from rolesFor("${endpoint.action}") [${expected}]; use allowedRoles: rolesFor("${endpoint.action}")`,
      );
    }
  }
  return problems;
}
