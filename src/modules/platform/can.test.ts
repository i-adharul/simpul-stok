import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api-error";
import { ACTIONS, authorize, can, type Action } from "./can";
import type { RequestContext } from "./request-context";

const A = "wh-a";
const B = "wh-b";

const ctxOf = (role: RequestContext["role"], warehouseIds = [A]): RequestContext => ({
  userId: "u1",
  organizationId: "org1",
  role,
  warehouseIds,
});

const ORG_WRITES: Action[] = [
  "warehouse.manage",
  "product.manage",
  "member.manage",
  "subscription.manage",
];
const WAREHOUSE_WRITES: Action[] = ["stock.receive", "stock.adjust", "stock.transfer"];
const WAREHOUSE_READS: Action[] = ["stock.read", "history.read"];
const ORG_READS: Action[] = ["warehouse.read", "product.read"];

describe("can: Owner", () => {
  const owner = ctxOf("OWNER", [A, B]);
  it("may do every action", () => {
    for (const action of ACTIONS) {
      const resource =
        action.startsWith("stock.") || action === "history.read" ? { warehouseId: B } : undefined;
      expect(can(owner, action, resource), action).toBe(true);
    }
  });
  it("is denied a warehouse that is not in its list (archived or another organization)", () => {
    expect(can(owner, "stock.adjust", { warehouseId: "other-org-wh" })).toBe(false);
  });
});

describe("can: warehouse.read for one warehouse", () => {
  it("needs the warehouse to be in ctx.warehouseIds (so archived is denied here)", () => {
    const viewer = ctxOf("VIEWER", [A]);
    expect(can(viewer, "warehouse.read", { warehouseId: A })).toBe(true);
    expect(can(viewer, "warehouse.read", { warehouseId: B })).toBe(false);
    expect(can(viewer, "warehouse.read")).toBe(true);
  });
});

describe("can: Warehouse Admin", () => {
  const admin = ctxOf("WAREHOUSE_ADMIN");
  it("may receive, adjust, transfer and read in the assigned warehouse", () => {
    for (const action of [...WAREHOUSE_WRITES, ...WAREHOUSE_READS]) {
      expect(can(admin, action, { warehouseId: A }), action).toBe(true);
    }
  });
  it("is denied the same actions in an unassigned warehouse", () => {
    for (const action of [...WAREHOUSE_WRITES, ...WAREHOUSE_READS]) {
      expect(can(admin, action, { warehouseId: B }), action).toBe(false);
    }
  });
  it("is denied a warehouse action without a warehouse", () => {
    expect(can(admin, "stock.adjust")).toBe(false);
  });
  it("is denied products, warehouses, members and subscription management", () => {
    for (const action of ORG_WRITES) expect(can(admin, action), action).toBe(false);
  });
  it("may read the product and warehouse lists", () => {
    for (const action of ORG_READS) expect(can(admin, action), action).toBe(true);
  });
});

describe("can: Viewer", () => {
  const viewer = ctxOf("VIEWER");
  it("may read stock and history in the assigned warehouse only", () => {
    for (const action of WAREHOUSE_READS) {
      expect(can(viewer, action, { warehouseId: A }), action).toBe(true);
      expect(can(viewer, action, { warehouseId: B }), action).toBe(false);
    }
  });
  it("may not change anything", () => {
    for (const action of [...WAREHOUSE_WRITES, ...ORG_WRITES]) {
      expect(can(viewer, action, { warehouseId: A }), action).toBe(false);
    }
  });
  it("may read the product and warehouse lists", () => {
    for (const action of ORG_READS) expect(can(viewer, action), action).toBe(true);
  });
});

describe("can: transfer", () => {
  it("needs rights on the source warehouse; the destination is not checked here", () => {
    const admin = ctxOf("WAREHOUSE_ADMIN", [A]);
    expect(can(admin, "stock.transfer", { warehouseId: A })).toBe(true);
    expect(can(admin, "stock.transfer", { warehouseId: B })).toBe(false);
  });
});

describe("can: transfer.destinations", () => {
  it("is held by the Owner and the Warehouse Admin, not by the Viewer", () => {
    expect(can(ctxOf("OWNER"), "transfer.destinations")).toBe(true);
    expect(can(ctxOf("WAREHOUSE_ADMIN"), "transfer.destinations")).toBe(true);
    expect(can(ctxOf("VIEWER"), "transfer.destinations")).toBe(false);
  });
});

describe("can: platform admin", () => {
  it("has no access to tenant data", () => {
    const platform = ctxOf("PLATFORM_ADMIN", [A]);
    for (const action of ACTIONS)
      expect(can(platform, action, { warehouseId: A }), action).toBe(false);
  });
});

describe("authorize", () => {
  it("returns when allowed", () => {
    expect(() => authorize(ctxOf("OWNER", [A]), "stock.read", { warehouseId: A })).not.toThrow();
  });
  it("throws a 403 FORBIDDEN ApiError when denied", () => {
    try {
      authorize(ctxOf("VIEWER"), "stock.adjust", { warehouseId: A });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(403);
      expect((error as ApiError).code).toBe("FORBIDDEN");
    }
  });
});
