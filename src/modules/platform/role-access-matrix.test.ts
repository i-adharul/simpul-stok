import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api-error";
import { ACTIONS, authorize, type Action } from "./can";
import type { RequestContext } from "./request-context";

// BL02 / test plan "Role access": an explicit role x action table, written out by hand (not derived
// from can.ts) so a change in the rules has to change this table too. Disallowed means 403.
type Role = RequestContext["role"];
const ASSIGNED = "wh-assigned";
const OTHER = "wh-other";

const WAREHOUSE_ACTIONS: Action[] = [
  "stock.read",
  "history.read",
  "stock.receive",
  "stock.adjust",
  "stock.transfer",
];

// Allowed actions per role when the warehouse (if needed) is assigned.
const ALLOWED: Record<Role, Action[]> = {
  OWNER: [...ACTIONS],
  WAREHOUSE_ADMIN: [
    "warehouse.read",
    "product.read",
    "stock.read",
    "history.read",
    "stock.receive",
    "stock.adjust",
    "stock.transfer",
  ],
  VIEWER: ["warehouse.read", "product.read", "stock.read", "history.read"],
  PLATFORM_ADMIN: [],
};

const ctxOf = (role: Role): RequestContext => ({
  userId: "u1",
  organizationId: "org1",
  role,
  warehouseIds: [ASSIGNED],
});

function statusOfAuthorize(role: Role, action: Action, warehouseId?: string): number {
  try {
    authorize(ctxOf(role), action, warehouseId ? { warehouseId } : {});
    return 200;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("FORBIDDEN");
    return (error as ApiError).status;
  }
}

const roles = Object.keys(ALLOWED) as Role[];

describe("role x action matrix (assigned warehouse)", () => {
  for (const role of roles) {
    for (const action of ACTIONS) {
      const allowed = ALLOWED[role].includes(action);
      it(`${role} ${allowed ? "may" : "gets 403 on"} ${action}`, () => {
        const warehouseId = WAREHOUSE_ACTIONS.includes(action) ? ASSIGNED : undefined;
        expect(statusOfAuthorize(role, action, warehouseId)).toBe(allowed ? 200 : 403);
      });
    }
  }
});

describe("warehouse assignment", () => {
  for (const role of roles) {
    for (const action of WAREHOUSE_ACTIONS) {
      it(`${role} gets 403 on ${action} in a warehouse it is not assigned to`, () => {
        expect(statusOfAuthorize(role, action, OTHER)).toBe(403);
      });
      it(`${role} gets 403 on ${action} without naming a warehouse`, () => {
        expect(statusOfAuthorize(role, action)).toBe(403);
      });
    }
  }
});

describe("platform admin", () => {
  it("gets 403 on every action, even in a warehouse listed in its context", () => {
    for (const action of ACTIONS) {
      expect(statusOfAuthorize("PLATFORM_ADMIN", action, ASSIGNED), action).toBe(403);
      expect(statusOfAuthorize("PLATFORM_ADMIN", action), action).toBe(403);
    }
  });
  // Without a session organization it never gets a context at all: see request-context.test.ts
  // ("rejects a platform admin (no organization) with 403").
});
