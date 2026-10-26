import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { notFoundError } from "../../lib/api-error";
import type { RequestContext } from "./request-context";

// Tenant-scoped data access (CLAUDE.md rule 3, BL03, docs/03_Data_Model.md tenant isolation rule 2).
// Services and handlers receive this client, never the plain one. Every query on a tenant model gets
// the organizationId of the session added here, so a service cannot forget it.

// Models with an organizationId column. The model-coverage test derives the same list from Prisma
// and fails when a model is missing here, so a new tenant table cannot slip through unscoped.
export const TENANT_MODELS = [
  "User",
  "Subscription",
  "Warehouse",
  "UserWarehouse",
  "Product",
  "StockLevel",
  "StockTransfer",
  "StockMovement",
  "IdempotencyKey",
  "Invitation",
  "ImportJob",
  "Invoice",
  "AuditLog",
  "Notification",
] as const;

// Organization is the tenant itself: it has no organizationId, so it is scoped by `id` instead.
const ORGANIZATION_MODEL = "Organization";
// Global tables: readable (a tenant shows its plan), never writable.
export const GLOBAL_READ_MODELS = ["Plan"] as const;
// Global tables that tenant code has no business with (the payment webhook writes it, with no session).
export const DENIED_MODELS = ["WebhookEvent"] as const;

// Relations that point at a row shared by many tenants. Following them is fine for the row itself,
// but anything reached through them (organization.users, plan.subscriptions) is not scoped.
const SHARED_RELATIONS: Record<string, string> = { organization: "Organization", plan: "Plan" };
// The only Organization fields a tenant may change. An allowlist, so a column added later (slug,
// status, billing data) stays closed until someone decides it is the tenant's to edit.
const ORGANIZATION_EDITABLE_FIELDS = new Set(["name", "address"]);
// Tenant models a tenant may read but never write: billing owns them (payment webhook and cron
// run without a session and use the plain client through an ADR-backed allowlist entry, E8).
const READ_ONLY_TENANT_MODELS = new Set(["Subscription"]);

const READ_OPERATIONS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);
const UPDATE_OPERATIONS = new Set(["update", "updateMany", "updateManyAndReturn"]);
const DELETE_OPERATIONS = new Set(["delete", "deleteMany"]);

type Args = Record<string, unknown>;

const isRecord = (value: unknown): value is Args =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function scalarFieldsOf(model: string): Set<string> {
  const fields = (Prisma as unknown as Record<string, Record<string, string> | undefined>)[
    `${model}ScalarFieldEnum`
  ];
  return new Set(Object.keys(fields ?? {}));
}

// These are coding mistakes, not request errors: a plain Error becomes a 500, never a 4xx.
function refuse(reason: string): never {
  throw new Error(`Tenant client: ${reason}`);
}

// A write must use "unchecked" input: scalar columns only. A relation key (organization: connect,
// stockLevels: create) is a nested write, and nested writes never pass through this extension.
function assertScalarKeys(model: string, data: Args): void {
  const scalars = scalarFieldsOf(model);
  for (const key of Object.keys(data)) {
    if (!scalars.has(key)) {
      refuse(`${model}: "${key}" is not a column; relation inputs are not allowed in writes`);
    }
  }
}

// Foreign keys are plain columns here. This client does NOT check that the referenced row belongs
// to the organization: the service must look it up through this client first (ADR 0011).
function scopedCreateData(model: string, data: unknown, organizationId: string): Args {
  if (!isRecord(data)) refuse(`${model}: create data must be an object`);
  assertScalarKeys(model, data);
  if (data.organizationId !== undefined && data.organizationId !== organizationId) {
    refuse(`${model}: organizationId in data differs from the session`);
  }
  return { ...data, organizationId };
}

// Moving a row to another organization is never a valid update, so even the same value is refused.
function checkedUpdateData(model: string, data: unknown): void {
  if (!isRecord(data)) refuse(`${model}: update data must be an object`);
  assertScalarKeys(model, data);
  if ("organizationId" in data) refuse(`${model}: organizationId cannot be updated`);
}

function scopedWhere(model: string, where: unknown, organizationId: string): Args {
  const base = isRecord(where) ? where : {};
  if (model === ORGANIZATION_MODEL) {
    // `id: otherOrgId` stays as given and meets `id: ownId` in the AND, so it matches nothing.
    const and = base.AND === undefined ? [] : [base.AND].flat();
    return { ...base, AND: [...and, { id: organizationId }] };
  }
  if ("organizationId" in base && base.organizationId !== organizationId) {
    refuse(`${model}: organizationId in where differs from the session`);
  }
  return { ...base, organizationId };
}

// select/include may only follow a shared relation as plain columns: no further include and
// no relation inside its select.
function assertSafeRelationTree(tree: unknown): void {
  if (!isRecord(tree)) return;
  for (const [key, value] of Object.entries(tree)) {
    if (!isRecord(value)) continue;
    const target = SHARED_RELATIONS[key];
    if (target) {
      const inner = value.select;
      const columns = scalarFieldsOf(target);
      const onlySelect = Object.keys(value).every((k) => k === "select");
      const onlyColumns = !isRecord(inner) || Object.keys(inner).every((k) => columns.has(k));
      if (!onlySelect || !onlyColumns) {
        refuse(`"${key}" can only be included as plain columns (no nested include or relation)`);
      }
    } else {
      assertSafeRelationTree(value.select);
      assertSafeRelationTree(value.include);
    }
  }
}

function assertSafeReadShape(args: Args): void {
  assertSafeRelationTree(args.select);
  assertSafeRelationTree(args.include);
}

// Plan is global. A relation filter or include would reach other organizations' subscriptions.
function assertPlainPlanArgs(args: Args): void {
  if (args.include !== undefined) refuse("Plan: include is not allowed");
  const scalars = scalarFieldsOf("Plan");
  const inSelect = isRecord(args.select) ? Object.keys(args.select) : [];
  if (inSelect.some((key) => !scalars.has(key))) refuse("Plan: select must list columns only");
  const checkWhere = (where: unknown): void => {
    if (!isRecord(where)) return;
    for (const [key, value] of Object.entries(where)) {
      if (key === "AND" || key === "OR" || key === "NOT") {
        [value].flat().forEach(checkWhere);
      } else if (!scalars.has(key)) {
        refuse(`Plan: where on "${key}" is not allowed`);
      }
    }
  };
  checkWhere(args.where);
}

function scopeTenantModel(
  model: string,
  operation: string,
  args: Args,
  organizationId: string,
): Args {
  assertSafeReadShape(args);
  if (READ_ONLY_TENANT_MODELS.has(model) && !READ_OPERATIONS.has(operation)) {
    refuse(`${model} is read-only for a tenant`);
  }
  const withWhere = (): Args => ({
    ...args,
    where: scopedWhere(model, args.where, organizationId),
  });

  if (READ_OPERATIONS.has(operation) || DELETE_OPERATIONS.has(operation)) return withWhere();

  if (operation === "create") {
    return { ...args, data: scopedCreateData(model, args.data, organizationId) };
  }
  if (operation === "createMany" || operation === "createManyAndReturn") {
    const rows = [args.data].flat();
    return { ...args, data: rows.map((row) => scopedCreateData(model, row, organizationId)) };
  }
  if (UPDATE_OPERATIONS.has(operation)) {
    checkedUpdateData(model, args.data);
    return withWhere();
  }
  if (operation === "upsert") {
    checkedUpdateData(model, args.update);
    return {
      ...withWhere(),
      create: scopedCreateData(model, args.create, organizationId),
    };
  }
  return refuse(`${model}.${operation} is not supported`);
}

function scopeOrganization(operation: string, args: Args, organizationId: string): Args {
  assertSafeReadShape(args);
  if (READ_OPERATIONS.has(operation)) {
    return { ...args, where: scopedWhere(ORGANIZATION_MODEL, args.where, organizationId) };
  }
  if (operation === "update" || operation === "updateMany") {
    const data = args.data;
    checkedUpdateData(ORGANIZATION_MODEL, data);
    for (const field of isRecord(data) ? Object.keys(data) : []) {
      if (!ORGANIZATION_EDITABLE_FIELDS.has(field)) {
        refuse(`Organization: "${field}" cannot be changed by a tenant (only name and address)`);
      }
    }
    return { ...args, where: scopedWhere(ORGANIZATION_MODEL, args.where, organizationId) };
  }
  return refuse(`Organization.${operation} is not allowed`);
}

const RAW_OPERATIONS = new Set([
  "$queryRaw",
  "$queryRawUnsafe",
  "$executeRaw",
  "$executeRawUnsafe",
  "$runCommandRaw",
  "findRaw",
  "aggregateRaw",
]);

function isNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === "P2025";
}

// Rule 2: a row of another organization looks exactly like a row that does not exist. Prisma throws
// P2025 for update/delete/…OrThrow on no match; mapping it to notFoundError() avoids a 500.

function scopeArgs(model: string, operation: string, args: Args, organizationId: string): Args {
  if ((TENANT_MODELS as readonly string[]).includes(model)) {
    return scopeTenantModel(model, operation, args, organizationId);
  }
  if (model === ORGANIZATION_MODEL) return scopeOrganization(operation, args, organizationId);
  if ((GLOBAL_READ_MODELS as readonly string[]).includes(model)) {
    if (!READ_OPERATIONS.has(operation)) refuse(`${model} is read-only for a tenant`);
    assertPlainPlanArgs(args);
    return args;
  }
  return refuse(`${model} is not available to a tenant`);
}

export function createTenantClient(prisma: PrismaClient, context: RequestContext) {
  // A single top-level hook, not $allModels: only it also sees raw queries (model is undefined),
  // and it applies inside $transaction (interactive and array form) as well.
  return prisma.$extends({
    name: "tenant-scope",
    query: {
      async $allOperations({ model, operation, args, query }) {
        if (model === undefined || RAW_OPERATIONS.has(operation)) {
          refuse(`raw query "${operation}" is not allowed; use a model method`);
        }
        const scoped = scopeArgs(model, operation, args as Args, context.organizationId);
        try {
          return await query(scoped);
        } catch (error) {
          if (isNotFound(error)) throw notFoundError();
          throw error;
        }
      },
    },
  });
}

// What services and handlers accept. The raw SQL methods are hidden from the type; the hook above
// refuses them at runtime and ESLint bans them (eslint.config.mjs).
type Extended = ReturnType<typeof createTenantClient>;
export type RawMethod = "$queryRaw" | "$queryRawUnsafe" | "$executeRaw" | "$executeRawUnsafe";
// $connect, $disconnect and $on would act on the connection shared by every request.
export type TenantClient = Omit<
  Extended,
  RawMethod | "$extends" | "$connect" | "$disconnect" | "$on"
>;
