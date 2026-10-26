import { afterAll, beforeAll, beforeEach, describe, it, vi } from "vitest";
import { env } from "../../lib/env";
import type { PrismaClient } from "../../generated/prisma/client";
import { assertSameTestDatabase, assertTestDatabaseUrl, createTestPrisma } from "../test-database";
import {
  TENANT_ROLES,
  callRoute,
  cookieFor,
  createTwoTenants,
  type RouteHandler,
  type TenantRole,
  type TwoTenants,
} from "./fixtures";
import { isOrganizationAction } from "../../modules/platform/can";
import type { ItemEndpoint, ListEndpoint, TenantEndpoint } from "./registry";

// The cross-tenant harness (BL03, test plan "Tenant isolation"). describeTenantIsolation() turns one
// registry entry into a fixed list of checks, each run from organization A's session against
// organization B's data. A check fails with TenantIsolationFailure, whose message starts with the check
// name, so a test can assert WHICH check caught a flaw and not merely that something threw.

export const CHECK_NAMES = {
  noSession: "no session gets 401",
  platformAdmin: "platform admin gets 403",
  forbiddenRole: "role without permission gets 403 before existence",
  forbiddenInvalidBody: "role without permission gets 403 even with an invalid body",
  sameNotFound: "another organization's id gets the same 404 as a missing id",
  untouched: "another organization's row is left untouched",
  listClean: "list contains none of the other organization's rows",
  cursorClean: "cursor holding another organization's id leaks nothing",
  bodyOrganization: "organizationId from the request is ignored or rejected",
} as const;
export type CheckName = (typeof CHECK_NAMES)[keyof typeof CHECK_NAMES];

export class TenantIsolationFailure extends Error {
  constructor(
    readonly check: CheckName,
    detail: string,
  ) {
    super(`[${check}] ${detail}`);
    this.name = "TenantIsolationFailure";
  }
}

function fail(check: CheckName, detail: string): never {
  throw new TenantIsolationFailure(check, detail);
}

// A well-formed ID that exists nowhere: the baseline a foreign ID must be indistinguishable from.
const MISSING_ID = "019a0000-0000-7000-8000-000000000000";
const MALFORMED_ID = "not-a-uuid";

type Reply = { status: number; text: string; json: unknown };
type Caller = { userId?: string };
type SendOptions = { id?: string; body?: unknown; query?: string };

async function send(
  endpoint: TenantEndpoint,
  tenants: TwoTenants,
  caller: Caller,
  options: SendOptions = {},
): Promise<Reply> {
  const handler = (await endpoint.module())[endpoint.method] as RouteHandler | undefined;
  if (!handler)
    throw new Error(`${endpoint.name}: the route module does not export ${endpoint.method}`);
  const cookie = caller.userId ? await cookieFor(caller.userId) : undefined;
  let response: Response;
  if (endpoint.kind === "item") {
    const id = options.id ?? MISSING_ID;
    const body = "body" in options ? options.body : endpoint.body?.(tenants);
    response = await callRoute(handler, {
      method: endpoint.method,
      path: endpoint.path(id),
      cookie,
      body,
      params: { [endpoint.idParam]: id },
    });
  } else {
    const body =
      "body" in options
        ? options.body
        : endpoint.kind === "create"
          ? endpoint.body(tenants)
          : undefined;
    response = await callRoute(handler, {
      method: endpoint.method,
      path: options.query ? withQuery(endpoint.path, options.query) : endpoint.path,
      cookie,
      body,
    });
  }
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON; the checks only read status and text then
  }
  return { status: response.status, text, json };
}

const asA = (tenants: TwoTenants, role: TenantRole): Caller => ({ userId: tenants.a.users[role] });
const codeOf = (reply: Reply) => (reply.json as { code?: string } | null)?.code;
const describeReply = (reply: Reply) => `status ${reply.status}, body ${reply.text.slice(0, 200)}`;
const sameJson = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
const is2xx = (reply: Reply) => reply.status >= 200 && reply.status < 300;
const deniedRoles = (endpoint: TenantEndpoint) =>
  TENANT_ROLES.filter((role) => !endpoint.allowedRoles.includes(role));
const withQuery = (path: string, query: string) => path + (path.includes("?") ? "&" : "?") + query;

type Check = {
  name: CheckName;
  applies: (endpoint: TenantEndpoint) => boolean;
  run: (tenants: TwoTenants, endpoint: TenantEndpoint) => Promise<void>;
};

// Ties a check to the endpoint kind it understands, so its body sees the narrowed type.
function defineCheck<E extends TenantEndpoint>(
  name: CheckName,
  applies: (endpoint: TenantEndpoint) => endpoint is E,
  run: (tenants: TwoTenants, endpoint: E) => Promise<void>,
): Check {
  return {
    name,
    applies,
    run: (tenants, endpoint) => {
      if (!applies(endpoint)) throw new Error(`${name} does not apply to ${endpoint.name}`);
      return run(tenants, endpoint);
    },
  };
}

// An ID of B for item endpoints. List and create endpoints have no ID to aim at.
async function foreignId(
  tenants: TwoTenants,
  endpoint: TenantEndpoint,
): Promise<string | undefined> {
  return endpoint.kind === "create" ? undefined : endpoint.createRow(tenants, "b");
}

async function readRows(tenants: TwoTenants, endpoint: ItemEndpoint, id: string) {
  return endpoint.readRow(tenants.prisma, id);
}

const anyKind = (e: TenantEndpoint): e is TenantEndpoint => e !== undefined;
const isItem = (e: TenantEndpoint): e is ItemEndpoint => e.kind === "item";
const isList = (e: TenantEndpoint): e is ListEndpoint => e.kind === "list";
// A write whose permission is organization-level: withTenantRoute can check it before the input.
const isOrganizationWrite = (e: TenantEndpoint): e is TenantEndpoint =>
  (e.kind === "create" || (e.kind === "item" && e.method !== "GET")) &&
  isOrganizationAction(e.action);
const hasCursor = (e: TenantEndpoint): e is ListEndpoint => isList(e) && e.supportsCursor === true;
const takesInput = (e: TenantEndpoint): e is TenantEndpoint =>
  e.kind !== "item" || (e.method !== "GET" && e.body !== undefined);

export const CHECKS: Check[] = [
  defineCheck(CHECK_NAMES.noSession, anyKind, async (tenants, endpoint) => {
    const reply = await send(endpoint, tenants, {}, { id: await foreignId(tenants, endpoint) });
    if (reply.status !== 401 || codeOf(reply) !== "UNAUTHENTICATED") {
      fail(CHECK_NAMES.noSession, `expected 401 UNAUTHENTICATED, got ${describeReply(reply)}`);
    }
  }),
  defineCheck(CHECK_NAMES.platformAdmin, anyKind, async (tenants, endpoint) => {
    const caller = { userId: tenants.platformAdminId };
    const reply = await send(endpoint, tenants, caller, {
      id: await foreignId(tenants, endpoint),
    });
    if (reply.status !== 403 || codeOf(reply) !== "FORBIDDEN") {
      fail(CHECK_NAMES.platformAdmin, `expected 403 FORBIDDEN, got ${describeReply(reply)}`);
    }
  }),
  defineCheck(CHECK_NAMES.forbiddenRole, anyKind, async (tenants, endpoint) => {
    const id = await foreignId(tenants, endpoint);
    const before = isItem(endpoint) && id ? await readRows(tenants, endpoint, id) : null;
    const bBefore =
      endpoint.kind === "create"
        ? await endpoint.countRows(tenants.prisma, tenants.b.organizationId)
        : 0;
    const aBefore =
      endpoint.kind === "create"
        ? await endpoint.countRows(tenants.prisma, tenants.a.organizationId)
        : 0;
    for (const role of deniedRoles(endpoint)) {
      const reply = await send(endpoint, tenants, asA(tenants, role), { id });
      if (reply.status !== 403 || codeOf(reply) !== "FORBIDDEN") {
        fail(
          CHECK_NAMES.forbiddenRole,
          `${role}: expected 403 FORBIDDEN, got ${describeReply(reply)}`,
        );
      }
    }
    if (isItem(endpoint) && id) {
      const after = await readRows(tenants, endpoint, id);
      if (!sameJson(before, after))
        fail(CHECK_NAMES.forbiddenRole, "a forbidden role changed the row");
    }
    if (endpoint.kind === "create") {
      const bAfter = await endpoint.countRows(tenants.prisma, tenants.b.organizationId);
      const aAfter = await endpoint.countRows(tenants.prisma, tenants.a.organizationId);
      if (bAfter !== bBefore || aAfter !== aBefore) {
        fail(CHECK_NAMES.forbiddenRole, "a forbidden role created a row");
      }
    }
  }),
  defineCheck(CHECK_NAMES.forbiddenInvalidBody, isOrganizationWrite, async (tenants, endpoint) => {
    // `{}` is invalid for any endpoint that takes a body. If the route validated first, a role that may
    // not act would get 400 and learn what the body must look like.
    const id = await foreignId(tenants, endpoint);
    for (const role of deniedRoles(endpoint)) {
      const reply = await send(endpoint, tenants, asA(tenants, role), { id, body: {} });
      if (reply.status !== 403 || codeOf(reply) !== "FORBIDDEN") {
        fail(
          CHECK_NAMES.forbiddenInvalidBody,
          `${role}: expected 403 FORBIDDEN, got ${describeReply(reply)}`,
        );
      }
    }
  }),
  defineCheck(CHECK_NAMES.sameNotFound, isItem, async (tenants, endpoint) => {
    const id = await endpoint.createRow(tenants, "b");
    for (const role of endpoint.allowedRoles) {
      const foreign = await send(endpoint, tenants, asA(tenants, role), { id });
      const missing = await send(endpoint, tenants, asA(tenants, role), { id: MISSING_ID });
      if (missing.status !== 404 || codeOf(missing) !== "NOT_FOUND") {
        fail(
          CHECK_NAMES.sameNotFound,
          `${role}: a missing id must give 404 NOT_FOUND, got ${describeReply(missing)}`,
        );
      }
      if (foreign.status !== missing.status || foreign.text !== missing.text) {
        fail(
          CHECK_NAMES.sameNotFound,
          `${role}: another organization's id differs from a missing id: ${describeReply(foreign)} vs ${describeReply(missing)}`,
        );
      }
      const malformed = await send(endpoint, tenants, asA(tenants, role), { id: MALFORMED_ID });
      if (malformed.status >= 500 || is2xx(malformed)) {
        fail(
          CHECK_NAMES.sameNotFound,
          `${role}: a malformed id must be a 4xx, got ${describeReply(malformed)}`,
        );
      }
    }
  }),
  defineCheck(CHECK_NAMES.untouched, isItem, async (tenants, endpoint) => {
    for (const role of endpoint.allowedRoles) {
      const id = await endpoint.createRow(tenants, "b");
      const before = await readRows(tenants, endpoint, id);
      if (!before)
        throw new Error(`${endpoint.name}: createRow returned an id that readRow cannot find`);
      await send(endpoint, tenants, asA(tenants, role), { id });
      const after = await readRows(tenants, endpoint, id);
      if (!sameJson(before, after)) {
        fail(
          CHECK_NAMES.untouched,
          `${role} on ${endpoint.method}: B's row changed from ${JSON.stringify(before)} to ${JSON.stringify(after)}`,
        );
      }
    }
  }),
  defineCheck(CHECK_NAMES.listClean, isList, async (tenants, endpoint) => {
    const aId = await endpoint.createRow(tenants, "a");
    const bId = await endpoint.createRow(tenants, "b");
    for (const role of endpoint.allowedRoles) {
      const reply = await send(endpoint, tenants, asA(tenants, role));
      if (reply.status !== 200)
        fail(CHECK_NAMES.listClean, `${role}: expected 200, got ${describeReply(reply)}`);
      const ids = endpoint.idsOf(reply.json);
      if (ids.includes(bId))
        fail(CHECK_NAMES.listClean, `${role}: the list contains B's row ${bId}`);
      if (!ids.includes(aId))
        fail(CHECK_NAMES.listClean, `${role}: the list does not contain A's own row ${aId}`);
    }
  }),
  defineCheck(CHECK_NAMES.cursorClean, hasCursor, async (tenants, endpoint) => {
    const list = endpoint;
    const bId = await list.createRow(tenants, "b");
    await list.createRow(tenants, "a");
    const cursor = (list.encodeCursor ?? ((id: string) => id))(bId);
    const reply = await send(endpoint, tenants, asA(tenants, list.allowedRoles[0]), {
      query: `cursor=${encodeURIComponent(cursor)}`,
    });
    if (reply.status === 200) {
      if (list.idsOf(reply.json).includes(bId)) {
        fail(CHECK_NAMES.cursorClean, `a cursor holding B's id returned B's row ${bId}`);
      }
    } else if (reply.status !== 400 && reply.status !== 404) {
      fail(CHECK_NAMES.cursorClean, `expected 200, 400 or 404, got ${describeReply(reply)}`);
    }
  }),
  defineCheck(CHECK_NAMES.bodyOrganization, takesInput, async (tenants, endpoint) => {
    const role = endpoint.allowedRoles[0];
    const other = tenants.b.organizationId;
    if (endpoint.kind === "list") {
      const bId = await endpoint.createRow(tenants, "b");
      const reply = await send(endpoint, tenants, asA(tenants, role), {
        query: `organizationId=${other}`,
      });
      if (reply.status === 200 && endpoint.idsOf(reply.json).includes(bId)) {
        fail(CHECK_NAMES.bodyOrganization, "?organizationId=<B> made the list return B's row");
      } else if (reply.status !== 200 && reply.status !== 400) {
        fail(CHECK_NAMES.bodyOrganization, `expected 200 or 400, got ${describeReply(reply)}`);
      }
      return;
    }
    if (endpoint.kind === "create") {
      const bBefore = await endpoint.countRows(tenants.prisma, other);
      const aBefore = await endpoint.countRows(tenants.prisma, tenants.a.organizationId);
      const body = { ...(endpoint.body(tenants) as object), organizationId: other };
      const reply = await send(endpoint, tenants, asA(tenants, role), { body });
      if (!is2xx(reply) && reply.status !== 400) {
        fail(
          CHECK_NAMES.bodyOrganization,
          `expected 2xx (ignored) or 400 (rejected), got ${describeReply(reply)}`,
        );
      }
      const bAfter = await endpoint.countRows(tenants.prisma, other);
      const aAfter = await endpoint.countRows(tenants.prisma, tenants.a.organizationId);
      if (bAfter !== bBefore)
        fail(CHECK_NAMES.bodyOrganization, "organizationId in the body created a row in B");
      if (is2xx(reply) && aAfter !== aBefore + 1) {
        fail(
          CHECK_NAMES.bodyOrganization,
          "the row was created, but not in the caller's own organization",
        );
      }
      return;
    }
    const id = await endpoint.createRow(tenants, "a");
    const body = { ...(endpoint.body?.(tenants) as object), organizationId: other };
    const reply = await send(endpoint, tenants, asA(tenants, role), { id, body });
    if (!is2xx(reply) && reply.status !== 400) {
      fail(
        CHECK_NAMES.bodyOrganization,
        `expected 2xx (ignored) or 400 (rejected), got ${describeReply(reply)}`,
      );
    }
    const row = await readRows(tenants, endpoint, id);
    if (row && row.organizationId !== tenants.a.organizationId) {
      fail(CHECK_NAMES.bodyOrganization, "organizationId in the body moved A's row to B");
    }
  }),
];

export function checkNamed(name: CheckName): Check {
  const check = CHECKS.find((c) => c.name === name);
  if (!check) throw new Error(`unknown check ${name}`);
  return check;
}

// Runs one check outside describeTenantIsolation (the self-test does this to read the failure).
export function runCheck(name: CheckName, tenants: TwoTenants, endpoint: TenantEndpoint) {
  return checkNamed(name).run(tenants, endpoint);
}

// Opens the test database and builds the two tenants. Shared with the self-test.
export async function openTenants(): Promise<{ prisma: PrismaClient; tenants: TwoTenants }> {
  // Route modules build their own client from DATABASE_URL; it must be the test database too.
  assertSameTestDatabase(env.DATABASE_URL, env.TEST_DATABASE_URL);
  const prisma = createTestPrisma(assertTestDatabaseUrl(env.TEST_DATABASE_URL));
  return { prisma, tenants: await createTwoTenants(prisma) };
}

export function describeTenantIsolation(endpoints: TenantEndpoint[]): void {
  // An empty suite is an error in Vitest, and with no endpoint there is nothing to open a database for.
  if (endpoints.length === 0) return;
  describe("cross-tenant isolation", () => {
    let prisma: PrismaClient;
    let tenants: TwoTenants;

    beforeAll(async () => {
      ({ prisma, tenants } = await openTenants());
    });
    beforeEach(() => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterAll(async () => {
      vi.restoreAllMocks();
      await prisma?.$disconnect();
    });

    for (const endpoint of endpoints) {
      describe(endpoint.name, () => {
        for (const check of CHECKS.filter((c) => c.applies(endpoint))) {
          it(check.name, () => check.run(tenants, endpoint));
        }
      });
    }
  });
}
