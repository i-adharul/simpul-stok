import bcrypt from "bcryptjs";
import type { PrismaClient, UserRole } from "../../generated/prisma/client";

// Demo data for development (story E0-07). It is a bootstrap script, so it uses the plain Prisma
// client: the tenant-scoped client (CLAUDE.md rule 3) does not exist yet and a seed has no session.

export const BCRYPT_COST = 12; // CLAUDE.md stack: bcryptjs with cost 12

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_DAYS = 30; // BL04
const GRACE_DAYS = 3; // BL04

// Prices and limits come from the "Plans" design decision in docs/02_Functional_Spec.md.
const PLANS = [
  { name: "Starter", priceIdr: 300_000, maxWarehouses: 2, maxProducts: 100, maxMembers: 3 },
  { name: "Business", priceIdr: 700_000, maxWarehouses: 10, maxProducts: 500, maxMembers: 10 },
] as const;

export const DEMO_ORGANIZATION = { name: "Toko Demo", slug: "demotoko" } as const;

// Demo passwords only. They follow the password rules (8 to 72 characters, a letter and a digit,
// not the email, not a common password) and must never be used outside development.
export const DEMO_ACCOUNTS: readonly {
  email: string;
  name: string;
  role: UserRole;
  password: string;
  inOrganization: boolean;
}[] = [
  {
    email: "admin@simpul.test",
    name: "Admin Platform",
    role: "PLATFORM_ADMIN",
    password: "platform-demo-2026",
    inOrganization: false,
  },
  {
    email: "owner@demotoko.test",
    name: "Owner Demo",
    role: "OWNER",
    password: "owner-demo-2026",
    inOrganization: true,
  },
  {
    email: "gudang@demotoko.test",
    name: "Admin Gudang Demo",
    role: "WAREHOUSE_ADMIN",
    password: "gudang-demo-2026",
    inOrganization: true,
  },
  {
    email: "viewer@demotoko.test",
    name: "Viewer Demo",
    role: "VIEWER",
    password: "viewer-demo-2026",
    inOrganization: true,
  },
];

// Runs in one transaction and can be repeated: every step is an upsert or a create-if-missing.
export async function seedBase(prisma: PrismaClient): Promise<void> {
  // Hash outside the transaction: cost 12 is slow and would keep a connection busy.
  const hashes = await hashPasswords();

  await prisma.$transaction(async (tx) => {
    const starter = await upsertPlans(tx);
    const organization = await tx.organization.upsert({
      where: { slug: DEMO_ORGANIZATION.slug },
      update: {}, // keep what a developer changed in the demo organization
      create: { ...DEMO_ORGANIZATION, status: "TRIAL" },
    });
    await createSubscriptionIfMissing(tx, organization.id, starter.id);
    for (const account of DEMO_ACCOUNTS) {
      await createUserIfMissing(tx, account, organization.id, hashes.get(account.email)!);
    }
  });
}

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

async function hashPasswords(): Promise<Map<string, string>> {
  const entries = await Promise.all(
    DEMO_ACCOUNTS.map(async (a) => [a.email, await bcrypt.hash(a.password, BCRYPT_COST)] as const),
  );
  return new Map(entries);
}

// Plans are global reference data, so a repeat run puts prices and limits back to the documented values.
async function upsertPlans(tx: Tx) {
  let starter: { id: string } | undefined;
  for (const plan of PLANS) {
    const row = await tx.plan.upsert({ where: { name: plan.name }, update: plan, create: plan });
    if (plan.name === "Starter") starter = row;
  }
  return starter!;
}

// A trial points to Starter with a 30-day period (BL04). update is empty so a repeat run
// does not move the dates.
async function createSubscriptionIfMissing(tx: Tx, organizationId: string, planId: string) {
  const start = new Date();
  const end = new Date(start.getTime() + TRIAL_DAYS * DAY_MS);
  await tx.subscription.upsert({
    where: { organizationId },
    update: {},
    create: {
      organizationId,
      planId,
      currentPeriodStart: start,
      currentPeriodEnd: end,
      graceUntil: new Date(end.getTime() + GRACE_DAYS * DAY_MS),
    },
  });
}

// Never overwrites an existing user: a repeat run must not reset a password someone has changed.
async function createUserIfMissing(
  tx: Tx,
  account: (typeof DEMO_ACCOUNTS)[number],
  organizationId: string,
  passwordHash: string,
) {
  await tx.user.upsert({
    where: { email: account.email },
    update: {},
    create: {
      email: account.email,
      name: account.name,
      role: account.role,
      passwordHash,
      organizationId: account.inOrganization ? organizationId : null,
    },
  });
}
