-- CreateEnum
CREATE TYPE "organization_status" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('PLATFORM_ADMIN', 'OWNER', 'WAREHOUSE_ADMIN', 'VIEWER');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "address" TEXT,
    "status" "organization_status" NOT NULL DEFAULT 'TRIAL',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(3),
    "password_changed_at" TIMESTAMPTZ(3),
    "reset_token_hash" TEXT,
    "reset_expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "price_idr" INTEGER NOT NULL,
    "max_warehouses" INTEGER NOT NULL,
    "max_products" INTEGER NOT NULL,
    "max_members" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "billing_day" INTEGER,
    "current_period_start" TIMESTAMPTZ(3) NOT NULL,
    "current_period_end" TIMESTAMPTZ(3) NOT NULL,
    "grace_until" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "plans_name_key" ON "plans"("name");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_organization_id_key" ON "subscriptions"("organization_id");

-- CreateIndex
CREATE INDEX "subscriptions_plan_id_idx" ON "subscriptions"("plan_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Custom SQL: rules that schema.prisma cannot express (docs/03_Data_Model.md, ERD_Relations.md).
-- ============================================================================

-- organizations.slug: 3 to 30 lowercase letters and digits, no hyphen (it is used in URLs).
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_slug_format_check"
    CHECK (slug ~ '^[a-z0-9]{3,30}$');

-- users.email is stored in lowercase. The plain unique index would treat A@x.com and a@x.com as
-- different people, so the database enforces the lowercase form (the app lowercases too).
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_check"
    CHECK (email = lower(email));

-- Exactly one OWNER per organization (BL07). A partial unique index only covers OWNER rows, so any
-- number of other roles is still allowed. Users without an organization are not indexed (NULL).
CREATE UNIQUE INDEX "users_one_owner_per_org" ON "users"(organization_id) WHERE role = 'OWNER';

-- A PLATFORM_ADMIN has no organization; every other role must have one. Without this, a tenant
-- user with a NULL organization_id could slip past the tenant filter.
ALTER TABLE "users" ADD CONSTRAINT "users_role_organization_check"
    CHECK ((role = 'PLATFORM_ADMIN') = (organization_id IS NULL));

-- The reset token and its expiry are filled together or not at all.
ALTER TABLE "users" ADD CONSTRAINT "users_reset_pair_check"
    CHECK ((reset_token_hash IS NULL) = (reset_expires_at IS NULL));

-- Plan prices cannot be negative and every limit must allow at least one item.
ALTER TABLE "plans" ADD CONSTRAINT "plans_positive_values_check"
    CHECK (price_idr >= 0 AND max_warehouses > 0 AND max_products > 0 AND max_members > 0);

-- billing_day is empty during the trial and 1 to 31 after the first payment (BL21, BL22).
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_billing_day_check"
    CHECK (billing_day IS NULL OR billing_day BETWEEN 1 AND 31);

-- A period has a positive length, and the grace date is not before the period end (BL04).
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_period_check"
    CHECK (current_period_end > current_period_start AND grace_until >= current_period_end);
