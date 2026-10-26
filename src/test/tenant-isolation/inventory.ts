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

// Stock writes must opt in to the Idempotency-Key wrapper, so a new endpoint cannot forget it (BL14).
// The prefixes are route folders below src/app/api: stock/receive, stock/adjust, stock/transfers,
// transfers..., imports/[id]/commit.
const IDEMPOTENT_ROUTE_PREFIXES = ["stock/", "transfers", "imports"];

export function idempotencyProblems(
  endpoints: { name: string; route: string; method: string; idempotent?: true }[],
  exempt: Record<string, string>,
): string[] {
  const problems: string[] = [];
  for (const [name, reason] of Object.entries(exempt)) {
    if (reason.trim() === "") problems.push(`IDEMPOTENCY_EXEMPT "${name}" has no reason`);
  }
  for (const endpoint of endpoints) {
    const writes = endpoint.method !== "GET";
    const stockWrite = IDEMPOTENT_ROUTE_PREFIXES.some((prefix) =>
      endpoint.route.startsWith(prefix),
    );
    if (endpoint.idempotent && !writes) {
      problems.push(`${endpoint.name}: idempotent is set on a GET; only writes take a key`);
    }
    if (writes && stockWrite && !endpoint.idempotent && !(endpoint.name in exempt)) {
      problems.push(
        `${endpoint.name}: a stock write must be idempotent: true (withTenantRoute option and registry entry), or be listed in IDEMPOTENCY_EXEMPT with a reason`,
      );
    }
  }
  return problems;
}

// Every foreign key in the body of a stock write needs its own foreignBodies variant, so a new endpoint (adjust,
// transfer, import commit) or a new key (the destination warehouse) cannot slip past the check "foreign key of
// another organization gets the same response as a missing one". A key is a body property that ends in "Id" and
// holds a UUID. The variant must replace EXACTLY that key (the others stay valid) and its missingBody must
// replace the same key with a different UUID.
const UUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ForeignKeyEntry = {
  name: string;
  route: string;
  method: string;
  body?: (tenants: never) => unknown;
  foreignBodies?: (tenants: never) => { name: string; body: unknown; missingBody: unknown }[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const idKeysOf = (body: unknown): string[] =>
  isRecord(body)
    ? Object.entries(body)
        .filter(
          ([key, value]) =>
            key.endsWith("Id") && typeof value === "string" && UUID_VALUE.test(value),
        )
        .map(([key]) => key)
    : [];

// The keys whose value differs between two bodies.
const changedKeys = (base: Record<string, unknown>, other: unknown): string[] =>
  isRecord(other)
    ? [...new Set([...Object.keys(base), ...Object.keys(other)])].filter(
        (key) => JSON.stringify(base[key]) !== JSON.stringify(other[key]),
      )
    : ["(not an object)"];

export function foreignKeyProblems(endpoints: ForeignKeyEntry[], tenants: unknown): string[] {
  const problems: string[] = [];
  for (const endpoint of endpoints) {
    const writes = endpoint.method !== "GET";
    if (!writes || !IDEMPOTENT_ROUTE_PREFIXES.some((prefix) => endpoint.route.startsWith(prefix))) {
      continue;
    }
    const body = endpoint.body?.(tenants as never);
    const keys = idKeysOf(body);
    const variants = endpoint.foreignBodies?.(tenants as never) ?? [];
    if (keys.length > 0 && variants.length === 0) {
      problems.push(
        `${endpoint.name}: the body has the id keys [${keys}], but the entry has no foreignBodies`,
      );
      continue;
    }
    const covered = new Set<string>();
    for (const variant of variants) {
      const foreign = changedKeys(body as Record<string, unknown>, variant.body);
      const missing = changedKeys(body as Record<string, unknown>, variant.missingBody);
      const key = foreign[0];
      if (foreign.length !== 1 || !keys.includes(key)) {
        problems.push(
          `${endpoint.name}: variant "${variant.name}" must replace exactly one id key of the body, it changes [${foreign}]`,
        );
      } else if (missing.length !== 1 || missing[0] !== key) {
        problems.push(
          `${endpoint.name}: the missingBody of "${variant.name}" must replace exactly "${key}", it changes [${missing}]`,
        );
      } else {
        covered.add(key);
      }
    }
    for (const key of keys) {
      if (!covered.has(key)) {
        problems.push(`${endpoint.name}: the id key "${key}" has no foreignBodies variant`);
      }
    }
  }
  return problems;
}
