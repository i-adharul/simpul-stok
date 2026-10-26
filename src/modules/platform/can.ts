import { ApiError, ERROR_CODES } from "../../lib/api-error";
import type { RequestContext } from "./request-context";

// BL02: the single authorization entry point for endpoints (docs/02 "Roles and permissions").
// Services and handlers call can()/authorize(); nobody compares roles inline.
export const ACTIONS = [
  // Organization-level
  "warehouse.read",
  "product.read",
  "warehouse.manage",
  "product.manage",
  "member.manage",
  "subscription.manage",
  // Warehouse-level (need resource.warehouseId)
  "stock.read",
  "history.read",
  "stock.receive",
  "stock.adjust",
  "stock.transfer",
] as const;

export type Action = (typeof ACTIONS)[number];

// Actions that need no warehouse: decided by the role alone, so withTenantRoute can check them before
// the input is read. The warehouse-level ones (stock.*, history.read) need a warehouseId, which only
// the handler knows, so the handler calls authorize() for them.
export const ORGANIZATION_ACTIONS = [
  "warehouse.read",
  "product.read",
  "warehouse.manage",
  "product.manage",
  "member.manage",
  "subscription.manage",
] as const satisfies readonly Action[];
export type OrganizationAction = (typeof ORGANIZATION_ACTIONS)[number];

export function isOrganizationAction(action: Action): action is OrganizationAction {
  return (ORGANIZATION_ACTIONS as readonly Action[]).includes(action);
}
export type Resource = { warehouseId?: string };

type Role = RequestContext["role"];

const ORG_READ: ReadonlySet<Action> = new Set(["warehouse.read", "product.read"]);
const WAREHOUSE_READ: ReadonlySet<Action> = new Set(["stock.read", "history.read"]);
const WAREHOUSE_WRITE: ReadonlySet<Action> = new Set([
  "stock.receive",
  "stock.adjust",
  "stock.transfer",
]);

// Role gate: does the role ever allow this action, ignoring which warehouse?
function roleAllows(role: Role, action: Action): boolean {
  switch (role) {
    case "OWNER":
      return true;
    case "WAREHOUSE_ADMIN":
      return ORG_READ.has(action) || WAREHOUSE_READ.has(action) || WAREHOUSE_WRITE.has(action);
    case "VIEWER":
      return ORG_READ.has(action) || WAREHOUSE_READ.has(action);
    default:
      // PLATFORM_ADMIN never touches tenant data.
      return false;
  }
}

// Warehouse gate: ctx.warehouseIds is already the user's active, same-organization warehouses
// (all of them for the Owner), so an archived or foreign warehouse is denied for every role.
// For a transfer, pass the SOURCE warehouse; the destination is validated by the transfer service.
export function can(ctx: RequestContext, action: Action, resource: Resource = {}): boolean {
  if (!roleAllows(ctx.role, action)) return false;
  if (WAREHOUSE_READ.has(action) || WAREHOUSE_WRITE.has(action)) {
    return resource.warehouseId !== undefined && ctx.warehouseIds.includes(resource.warehouseId);
  }
  // Reading one warehouse needs it to be assigned (and active); the list passes no warehouseId.
  if (action === "warehouse.read" && resource.warehouseId !== undefined) {
    return ctx.warehouseIds.includes(resource.warehouseId);
  }
  return true;
}

// Handler/service boundary: a denial becomes a 403 through withApiLog.
export function authorize(ctx: RequestContext, action: Action, resource: Resource = {}): void {
  if (!can(ctx, action, resource)) {
    throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Anda tidak punya akses untuk tindakan ini.");
  }
}
