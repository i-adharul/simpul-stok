import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import type { TwoTenants } from "./fixtures";
import {
  CHECKS,
  CHECK_NAMES,
  TenantIsolationFailure,
  describeTenantIsolation,
  openTenants,
  runCheck,
  type CheckName,
} from "./run-harness";
import {
  IDEMPOTENCY_FLAWS,
  createIdempotentTestRoutes,
  type IdempotencyFlaw,
} from "../idempotency/test-routes";
import {
  FLAWS,
  createWarehouseTestRoutes,
  type Flaw,
  type WarehouseTestRoutes,
} from "./test-routes";

// Proof that the harness works. No real tenant endpoint exists yet, so a test-only route over the
// warehouse table is used:
//   1. built correctly, it passes EVERY check (describeTenantIsolation below);
//   2. built with one deliberate flaw, the matching check fails with the expected message, while the
//      correct build passes that very same check.
// If a flaw ever stops being caught, the harness has gone blind and this file fails.

const control = createWarehouseTestRoutes();
afterAll(() => control.dispose());

describeTenantIsolation(Object.values(control.endpoints));

// A stock write built correctly (idempotent: true) passes every check, including the key check.
const idempotentControl = createIdempotentTestRoutes();
afterAll(() => idempotentControl.dispose());
describeTenantIsolation([idempotentControl.endpoint]);

type Expectation = {
  check: CheckName;
  endpoint: keyof WarehouseTestRoutes["endpoints"];
  message: RegExp;
};

// Every flaw maps to the check that must catch it, and to the text its failure must contain.
const EXPECTED: Record<Flaw, Expectation> = {
  "unscoped-read": {
    check: CHECK_NAMES.sameNotFound,
    endpoint: "read",
    message: /another organization's id differs from a missing id: status 200/,
  },
  "foreign-is-403": {
    check: CHECK_NAMES.sameNotFound,
    endpoint: "read",
    message: /another organization's id differs from a missing id: status 403/,
  },
  "unscoped-update": {
    check: CHECK_NAMES.untouched,
    endpoint: "update",
    message: /OWNER on PATCH: B's row changed from/,
  },
  "unscoped-delete": {
    check: CHECK_NAMES.untouched,
    endpoint: "remove",
    message: /OWNER on DELETE: B's row changed from/,
  },
  "unscoped-list": {
    check: CHECK_NAMES.listClean,
    endpoint: "list",
    message: /OWNER: the list contains B's row/,
  },
  "unscoped-cursor": {
    check: CHECK_NAMES.cursorClean,
    endpoint: "list",
    message: /a cursor holding B's id returned B's row/,
  },
  "lookup-before-authorize": {
    check: CHECK_NAMES.forbiddenRole,
    endpoint: "update",
    message: /WAREHOUSE_ADMIN: expected 403 FORBIDDEN, got status 404/,
  },
  "skips-authorize": {
    check: CHECK_NAMES.forbiddenRole,
    endpoint: "create",
    message: /WAREHOUSE_ADMIN: expected 403 FORBIDDEN, got status 201/,
  },
  "validates-before-authorizing": {
    check: CHECK_NAMES.forbiddenInvalidBody,
    endpoint: "update",
    message: /WAREHOUSE_ADMIN: expected 403 FORBIDDEN, got status 400/,
  },
  "trusts-body-org": {
    check: CHECK_NAMES.bodyOrganization,
    endpoint: "create",
    message: /organizationId in the body created a row in B/,
  },
};

// The flaws of a stock write that uses the Idempotency-Key wrapper, each with the check that must catch it.
const IDEMPOTENCY_EXPECTED: Record<IdempotencyFlaw, { check: CheckName; message: RegExp }> = {
  "ignores-idempotency-header": {
    check: CHECK_NAMES.idempotencyKey,
    message: /a key that is missing must give 400 VALIDATION_ERROR, got status 201/,
  },
  "never-calls-runIdempotent": {
    check: CHECK_NAMES.sameKeyTwice,
    message: /the second response body differs from the first/,
  },
  "trusts-foreign-product": {
    check: CHECK_NAMES.foreignKey,
    // Without the lookup a random product id breaks the foreign key (500), so the baseline already fails.
    message: /product of B: a random UUID must give 404, got status 500/,
  },
};

describe("harness self-test: a flawed route turns the harness red", () => {
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
    await prisma.$disconnect();
  });

  it("covers every check with at least one flaw", () => {
    // The idempotency flaws are in IDEMPOTENCY_EXPECTED (they need a route that uses runIdempotent).
    const covered = new Set<CheckName>([
      ...Object.values(EXPECTED).map((e) => e.check),
      ...Object.values(IDEMPOTENCY_EXPECTED).map((e) => e.check),
    ]);
    for (const check of CHECKS) {
      // noSession and platformAdmin are enforced by withTenantRoute itself, not by route code,
      // so a route cannot be written with those flaws.
      if (check.name === CHECK_NAMES.noSession || check.name === CHECK_NAMES.platformAdmin)
        continue;
      expect(covered.has(check.name), `no flaw exercises "${check.name}"`).toBe(true);
    }
    expect(Object.keys(EXPECTED).sort()).toEqual([...FLAWS].sort());
    expect(Object.keys(IDEMPOTENCY_EXPECTED).sort()).toEqual([...IDEMPOTENCY_FLAWS].sort());
  });

  it.each(FLAWS)("flaw %s is caught with the expected message", async (flaw) => {
    const expected = EXPECTED[flaw];
    const flawed = createWarehouseTestRoutes([flaw]);
    try {
      const error = await runCheck(
        expected.check,
        tenants,
        flawed.endpoints[expected.endpoint],
      ).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error, `"${expected.check}" did not fail for flaw ${flaw}`).toBeInstanceOf(
        TenantIsolationFailure,
      );
      const failure = error as TenantIsolationFailure;
      expect(failure.check).toBe(expected.check);
      expect(failure.message).toMatch(expected.message);

      // The control: the correct route passes this very check.
      await runCheck(expected.check, tenants, control.endpoints[expected.endpoint]);
    } finally {
      await flawed.dispose();
    }
  });
  it.each(IDEMPOTENCY_FLAWS)("flaw %s is caught with the expected message", async (flaw) => {
    const expected = IDEMPOTENCY_EXPECTED[flaw];
    const flawed = createIdempotentTestRoutes({ flaws: [flaw] });
    try {
      const error = await runCheck(expected.check, tenants, flawed.endpoint).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error, `"${expected.check}" did not fail for flaw ${flaw}`).toBeInstanceOf(
        TenantIsolationFailure,
      );
      expect((error as TenantIsolationFailure).check).toBe(expected.check);
      expect((error as TenantIsolationFailure).message).toMatch(expected.message);
      // The control: the correct route passes this very check.
      await runCheck(expected.check, tenants, idempotentControl.endpoint);
    } finally {
      await flawed.dispose();
    }
  });
});
