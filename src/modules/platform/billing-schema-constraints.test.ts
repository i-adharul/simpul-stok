import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../../lib/env";
import type { PrismaClient } from "../../generated/prisma/client";
import { assertTestDatabaseUrl, createTestPrisma } from "../../test/test-database";

// Raw SQL on purpose: the database must reject bad rows no matter which code path wrote them.
// Covers Invitation, Invoice, WebhookEvent, AuditLog and Notification (E0-06).

let prisma: PrismaClient;

beforeAll(() => {
  prisma = createTestPrisma(assertTestDatabaseUrl(env.TEST_DATABASE_URL));
});

beforeEach(async () => {
  assertTestDatabaseUrl(env.TEST_DATABASE_URL); // never truncate anything but a *_test database
  // TRUNCATE is not blocked by the audit_logs trigger (statement-level event), so tests can clean up.
  await prisma.$executeRaw`TRUNCATE TABLE webhook_events, notifications, audit_logs, invoices,
    invitations, subscriptions, users, plans, organizations RESTART IDENTITY CASCADE`;
});

afterAll(async () => {
  await prisma.$disconnect();
});

type Row = { id: string };

async function fixture(slug = "acme") {
  const org = await prisma.$queryRaw<Row[]>`
    INSERT INTO organizations (name, slug) VALUES (${"Org " + slug}, ${slug}) RETURNING id::text`;
  const orgId = org[0].id;
  const user = await prisma.$queryRaw<Row[]>`
    INSERT INTO users (organization_id, email, name, password_hash, role)
    VALUES (${orgId}::uuid, ${"owner@" + slug + ".test"}, 'Test', 'hash', 'OWNER') RETURNING id::text`;
  const plan = await prisma.$queryRaw<Row[]>`
    INSERT INTO plans (name, price_idr, max_warehouses, max_products, max_members)
    VALUES (${"Starter " + slug}, 100000, 2, 100, 3) RETURNING id::text`;
  const subscription = await prisma.$queryRaw<Row[]>`
    INSERT INTO subscriptions (organization_id, plan_id, current_period_start, current_period_end, grace_until)
    VALUES (${orgId}::uuid, ${plan[0].id}::uuid, now(), now() + interval '30 days', now() + interval '33 days')
    RETURNING id::text`;
  return { orgId, userId: user[0].id, planId: plan[0].id, subscriptionId: subscription[0].id };
}

type Ctx = Awaited<ReturnType<typeof fixture>>;

describe("invitations", () => {
  async function insertInvitation(
    ctx: Ctx,
    { email = "staff@acme.test", role = "VIEWER", tokenHash = "hash-1" } = {},
  ) {
    await prisma.$executeRaw`
      INSERT INTO invitations (organization_id, email, role, warehouse_ids, token_hash, expires_at, created_by_id)
      VALUES (${ctx.orgId}::uuid, ${email}, ${role}::user_role, ARRAY[]::uuid[], ${tokenHash},
              now() + interval '7 days', ${ctx.userId}::uuid)`;
  }

  it("stores the warehouse ids as a UUID array", async () => {
    const ctx = await fixture();
    await prisma.$executeRaw`
      INSERT INTO invitations (organization_id, email, role, warehouse_ids, token_hash, expires_at, created_by_id)
      VALUES (${ctx.orgId}::uuid, 'a@acme.test', 'WAREHOUSE_ADMIN',
              ARRAY[gen_random_uuid(), gen_random_uuid()], 'hash-array', now() + interval '7 days',
              ${ctx.userId}::uuid)`;
    const rows = await prisma.$queryRaw<{ n: number }[]>`
      SELECT cardinality(warehouse_ids)::int AS n FROM invitations`;
    expect(rows[0].n).toBe(2);
  });

  it("rejects a duplicate token hash", async () => {
    const ctx = await fixture();
    await insertInvitation(ctx);
    await expect(insertInvitation(ctx, { email: "other@acme.test" })).rejects.toThrow(
      /invitations_token_hash_key/,
    );
  });

  it.each(["OWNER", "PLATFORM_ADMIN"])("rejects the role %s", async (role) => {
    const ctx = await fixture();
    await expect(insertInvitation(ctx, { role })).rejects.toThrow(/invitations_role_check/);
  });

  it("rejects an email that is not lowercase", async () => {
    const ctx = await fixture();
    await expect(insertInvitation(ctx, { email: "Staff@Acme.test" })).rejects.toThrow(
      /invitations_email_lowercase_check/,
    );
  });
});

describe("invoices", () => {
  type InvoiceInput = {
    number?: string;
    externalId?: string;
    amountIdr?: number;
    status?: "PENDING" | "PAID" | "EXPIRED" | "FAILED";
    paid?: boolean;
    periodDays?: number;
  };

  async function insertInvoice(ctx: Ctx, input: InvoiceInput = {}) {
    const { number = "INV-2026-0001", externalId = "ext-1", amountIdr = 100000 } = input;
    const { status = "PENDING", paid = false, periodDays = 30 } = input;
    await prisma.$executeRaw`
      INSERT INTO invoices (organization_id, subscription_id, plan_id, number, amount_idr, kind,
                            period_start, period_end, status, external_id, due_at, expires_at, paid_at)
      VALUES (${ctx.orgId}::uuid, ${ctx.subscriptionId}::uuid, ${ctx.planId}::uuid, ${number}, ${amountIdr},
              'INITIAL', now(), now() + make_interval(days => ${periodDays}), ${status}::invoice_status,
              ${externalId}, now() + interval '7 days', now() + interval '7 days',
              ${paid ? new Date() : null}::timestamptz)`;
  }

  it("rejects a duplicate number in the same organization, allows it in another", async () => {
    const a = await fixture("orga");
    const b = await fixture("orgb");
    await insertInvoice(a);
    await expect(insertInvoice(a, { externalId: "ext-2" })).rejects.toThrow(
      /invoices_organization_id_number_key/,
    );
    await expect(insertInvoice(b, { externalId: "ext-3" })).resolves.toBeUndefined();
  });

  it("rejects a duplicate external id", async () => {
    const ctx = await fixture();
    await insertInvoice(ctx);
    await expect(insertInvoice(ctx, { number: "INV-2026-0002" })).rejects.toThrow(
      /invoices_external_id_key/,
    );
  });

  it.each([0, -5])("rejects the amount %i", async (amountIdr) => {
    const ctx = await fixture();
    await expect(insertInvoice(ctx, { amountIdr })).rejects.toThrow(/invoices_amount_check/);
  });

  it("rejects a period that ends before it starts", async () => {
    const ctx = await fixture();
    await expect(insertInvoice(ctx, { periodDays: -1 })).rejects.toThrow(/invoices_period_check/);
  });

  it("requires paid_at if and only if the status is PAID", async () => {
    const ctx = await fixture();
    await expect(insertInvoice(ctx, { status: "PAID", paid: false })).rejects.toThrow(
      /invoices_paid_at_check/,
    );
    await expect(insertInvoice(ctx, { status: "PENDING", paid: true })).rejects.toThrow(
      /invoices_paid_at_check/,
    );
    await expect(insertInvoice(ctx, { status: "PAID", paid: true })).resolves.toBeUndefined();
  });
});

describe("webhook_events", () => {
  async function insertEvent(provider = "xendit", eventId = "evt-1") {
    await prisma.$executeRaw`
      INSERT INTO webhook_events (provider, event_id, payload)
      VALUES (${provider}, ${eventId}, '{"status":"PAID"}'::jsonb)`;
  }

  it("has no organization_id column (global table)", async () => {
    const rows = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'webhook_events' AND column_name = 'organization_id'`;
    expect(rows[0].n).toBe(0);
  });

  it("rejects a duplicate (provider, event_id), allows the same event id for another provider", async () => {
    await insertEvent("xendit", "evt-1");
    await expect(insertEvent("xendit", "evt-1")).rejects.toThrow(
      /webhook_events_provider_event_id_key/,
    );
    await expect(insertEvent("other", "evt-1")).resolves.toBeUndefined();
  });
});

describe("audit_logs", () => {
  async function insertLog(ctx: Ctx) {
    const rows = await prisma.$queryRaw<Row[]>`
      INSERT INTO audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
      VALUES (${ctx.orgId}::uuid, ${ctx.userId}::uuid, 'WAREHOUSE_ARCHIVED', 'Warehouse', 'any-id',
              '{"reason":"test"}'::jsonb) RETURNING id::text`;
    return rows[0].id;
  }

  it("accepts an insert", async () => {
    const ctx = await fixture();
    await expect(insertLog(ctx)).resolves.toBeTruthy();
  });

  it("rejects UPDATE (append-only)", async () => {
    const ctx = await fixture();
    const id = await insertLog(ctx);
    await expect(
      prisma.$executeRaw`UPDATE audit_logs SET action = 'X' WHERE id = ${id}::uuid`,
    ).rejects.toThrow(/audit_logs are immutable/);
  });

  it("rejects DELETE (append-only)", async () => {
    const ctx = await fixture();
    const id = await insertLog(ctx);
    await expect(prisma.$executeRaw`DELETE FROM audit_logs WHERE id = ${id}::uuid`).rejects.toThrow(
      /audit_logs are immutable/,
    );
  });
});

describe("notifications", () => {
  async function insertNotification(ctx: Ctx, type = "LOW_STOCK") {
    await prisma.$executeRaw`
      INSERT INTO notifications (organization_id, user_id, type, message)
      VALUES (${ctx.orgId}::uuid, ${ctx.userId}::uuid, ${type}::notification_type, 'Stok menipis')`;
  }

  it.each(["LOW_STOCK", "INVOICE_DUE", "TRIAL_ENDING", "SUSPENDED"])(
    "accepts type %s",
    async (t) => {
      const ctx = await fixture();
      await expect(insertNotification(ctx, t)).resolves.toBeUndefined();
    },
  );

  it("rejects an unknown type", async () => {
    const ctx = await fixture();
    await expect(insertNotification(ctx, "OTHER")).rejects.toThrow(/notification_type/);
  });
});
