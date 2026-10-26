import type { PrismaClient, UserRole } from "../../generated/prisma/client";
import { env } from "../../lib/env";
import { SESSION_COOKIE_NAME, createSessionToken } from "../../modules/platform/session";

// Fixtures for the cross-tenant harness (BL03, test plan "Tenant isolation"). Two organizations with
// the same shape, so a check can run "as A against B" without knowing which is which.
export const TENANT_ROLES = ["OWNER", "WAREHOUSE_ADMIN", "VIEWER"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];
export type TenantKey = "a" | "b";

export type Tenant = {
  organizationId: string;
  users: Record<TenantRole, string>;
  warehouseId: string;
  productId: string;
  transferId: string;
};

export type TwoTenants = {
  prisma: PrismaClient;
  a: Tenant;
  b: Tenant;
  platformAdminId: string;
  // A value that is unique for this run, for columns with a unique constraint (sku, code, slug).
  unique(prefix: string): string;
};

// Tests run serially against one database, so every harness starts from empty tenant tables.
export async function resetTenantTables(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`TRUNCATE TABLE webhook_events, notifications, audit_logs, invoices,
    import_jobs, invitations, idempotency_keys, stock_movements, stock_transfers, stock_levels,
    user_warehouses, products, warehouses, subscriptions, users, plans, organizations
    RESTART IDENTITY CASCADE`;
}

async function createTenant(prisma: PrismaClient, slug: string): Promise<Tenant> {
  const org = await prisma.organization.create({ data: { name: slug, slug } });
  const warehouse = await prisma.warehouse.create({
    data: { organizationId: org.id, code: "W1", name: `${slug} main` },
  });
  const second = await prisma.warehouse.create({
    data: { organizationId: org.id, code: "W2", name: `${slug} second` },
  });
  const users = {} as Record<TenantRole, string>;
  for (const role of TENANT_ROLES) {
    const user = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: `${role.toLowerCase()}@${slug}.harness.test`,
        name: `${slug} ${role}`,
        passwordHash: "not-a-real-hash",
        role,
      },
    });
    users[role] = user.id;
  }
  // Non-owners only see the warehouses assigned to them (request-context.ts).
  for (const role of ["WAREHOUSE_ADMIN", "VIEWER"] as const) {
    await prisma.userWarehouse.create({
      data: { organizationId: org.id, userId: users[role], warehouseId: warehouse.id },
    });
  }
  const product = await prisma.product.create({
    data: { organizationId: org.id, sku: "SKU-1", name: `${slug} product`, unit: "pcs" },
  });
  const transfer = await prisma.stockTransfer.create({
    data: {
      organizationId: org.id,
      code: "MT-1",
      fromWarehouseId: warehouse.id,
      toWarehouseId: second.id,
      createdById: users.OWNER,
    },
  });
  return {
    organizationId: org.id,
    users,
    warehouseId: warehouse.id,
    productId: product.id,
    transferId: transfer.id,
  };
}

// Plain client on purpose: fixtures arrange data in BOTH organizations, which the tenant client
// refuses by design.
export async function createTwoTenants(prisma: PrismaClient): Promise<TwoTenants> {
  await resetTenantTables(prisma);
  const a = await createTenant(prisma, "orga");
  const b = await createTenant(prisma, "orgb");
  const admin = await prisma.user.create({
    data: {
      email: "admin@harness.test",
      name: "Platform admin",
      passwordHash: "not-a-real-hash",
      role: "PLATFORM_ADMIN" satisfies UserRole,
    },
  });
  let counter = 0;
  return {
    prisma,
    a,
    b,
    platformAdminId: admin.id,
    unique: (prefix) => `${prefix}-${Date.now().toString(36)}-${++counter}`,
  };
}

// Signed with the same SESSION_SECRET the route modules read through `env` under Vitest, so the
// handler under test accepts the cookie it would accept in production.
export async function cookieFor(userId: string): Promise<string> {
  return `${SESSION_COOKIE_NAME}=${await createSessionToken(userId, env.SESSION_SECRET)}`;
}

export type RouteHandler = (
  request: Request,
  context?: { params: Promise<unknown> },
) => Promise<Response>;

export type CallOptions = {
  method: string;
  path: string;
  cookie?: string;
  body?: unknown;
  params?: Record<string, string>;
};

// No HTTP server: the exported Route Handler is called with a Request. The proxy (CSRF) does not run
// in this setup, but the same-origin Origin header is still sent so the request looks like the app's.
export async function callRoute(handler: RouteHandler, options: CallOptions): Promise<Response> {
  const headers: Record<string, string> = { origin: "http://localhost" };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const request = new Request(`http://localhost${options.path}`, {
    method: options.method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return handler(request, options.params ? { params: Promise.resolve(options.params) } : undefined);
}
