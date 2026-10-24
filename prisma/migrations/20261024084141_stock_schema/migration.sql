-- CreateEnum
CREATE TYPE "product_unit" AS ENUM ('bks', 'ktk', 'pcs', 'btl', 'jrg', 'pak');

-- CreateEnum
CREATE TYPE "stock_movement_type" AS ENUM ('RECEIVE', 'ADJUST', 'TRANSFER_OUT', 'TRANSFER_IN', 'IMPORT');

-- CreateEnum
CREATE TYPE "stock_movement_reason" AS ENUM ('STOCK_OPNAME', 'DAMAGED', 'LOST', 'CORRECTION');

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_warehouses" (
    "user_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_warehouses_pkey" PRIMARY KEY ("user_id","warehouse_id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "product_unit" NOT NULL,
    "min_stock" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_levels" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "from_warehouse_id" UUID NOT NULL,
    "to_warehouse_id" UUID NOT NULL,
    "note" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "type" "stock_movement_type" NOT NULL,
    "transfer_id" UUID,
    "import_job_id" UUID,
    "reason" "stock_movement_reason",
    "note" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "organization_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("organization_id","key","endpoint")
);

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_organization_id_code_key" ON "warehouses"("organization_id", "code");

-- CreateIndex
CREATE INDEX "user_warehouses_organization_id_idx" ON "user_warehouses"("organization_id");

-- CreateIndex
CREATE INDEX "user_warehouses_warehouse_id_idx" ON "user_warehouses"("warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_organization_id_sku_key" ON "products"("organization_id", "sku");

-- CreateIndex
CREATE INDEX "stock_levels_organization_id_product_id_idx" ON "stock_levels"("organization_id", "product_id");

-- CreateIndex
CREATE INDEX "stock_levels_organization_id_warehouse_id_idx" ON "stock_levels"("organization_id", "warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_levels_warehouse_id_product_id_key" ON "stock_levels"("warehouse_id", "product_id");

-- CreateIndex
CREATE INDEX "stock_transfers_from_warehouse_id_idx" ON "stock_transfers"("from_warehouse_id");

-- CreateIndex
CREATE INDEX "stock_transfers_to_warehouse_id_idx" ON "stock_transfers"("to_warehouse_id");

-- CreateIndex
CREATE INDEX "stock_transfers_created_by_id_idx" ON "stock_transfers"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_organization_id_code_key" ON "stock_transfers"("organization_id", "code");

-- CreateIndex
CREATE INDEX "stock_movements_organization_id_created_at_id_idx" ON "stock_movements"("organization_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "stock_movements_organization_id_product_id_created_at_idx" ON "stock_movements"("organization_id", "product_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "stock_movements_organization_id_warehouse_id_created_at_idx" ON "stock_movements"("organization_id", "warehouse_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "stock_movements_transfer_id_idx" ON "stock_movements"("transfer_id");

-- CreateIndex
CREATE INDEX "stock_movements_created_by_id_idx" ON "stock_movements"("created_by_id");

-- CreateIndex
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys"("created_at");

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_warehouses" ADD CONSTRAINT "user_warehouses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_warehouses" ADD CONSTRAINT "user_warehouses_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_warehouses" ADD CONSTRAINT "user_warehouses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_warehouse_id_fkey" FOREIGN KEY ("from_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_warehouse_id_fkey" FOREIGN KEY ("to_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Custom SQL: rules that schema.prisma cannot express (docs/03_Data_Model.md, ERD_Relations.md).
-- ============================================================================

-- warehouses.code: uppercase and not empty; the rest of the format is free (BL08).
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_code_format_check"
    CHECK (code <> '' AND code = upper(code));

-- products.sku: not empty, uppercase, no whitespace at all (BL09).
ALTER TABLE "products" ADD CONSTRAINT "products_sku_format_check"
    CHECK (sku <> '' AND sku = upper(sku) AND sku !~ '\s');

-- The minimum threshold is a non-negative integer (BL09).
ALTER TABLE "products" ADD CONSTRAINT "products_min_stock_check"
    CHECK (min_stock >= 0);

-- Last safety net for "no negative stock" (BL13). The service uses a conditional atomic update first.
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_quantity_check"
    CHECK (quantity >= 0);

-- A transfer needs two different warehouses (BL13).
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_distinct_warehouses_check"
    CHECK (from_warehouse_id <> to_warehouse_id);

-- A movement that changes nothing is not a movement (BL12 rejects a difference of 0).
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_delta_nonzero_check"
    CHECK (quantity_delta <> 0);

-- Sign per type: only ADJUST may go both ways.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_delta_sign_check"
    CHECK (
        type = 'ADJUST'
        OR (type = 'TRANSFER_OUT' AND quantity_delta < 0)
        OR (type IN ('RECEIVE', 'TRANSFER_IN', 'IMPORT') AND quantity_delta > 0)
    );

-- Fields that belong to one type only:
--   transfer_id is filled if and only if the type is TRANSFER_OUT or TRANSFER_IN;
--   reason is filled if and only if the type is ADJUST (BL12 requires a reason);
--   import_job_id may be filled only for IMPORT, and is not required.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_type_fields_check"
    CHECK (
        (transfer_id IS NOT NULL) = (type IN ('TRANSFER_OUT', 'TRANSFER_IN'))
        AND (reason IS NOT NULL) = (type = 'ADJUST')
        AND (import_job_id IS NULL OR type = 'IMPORT')
    );

-- Stock movement rows are immutable (CLAUDE.md rule 8, ADR 0005). The trigger is row-level for
-- UPDATE and DELETE only. TRUNCATE is a statement-level event, so it is not blocked on purpose
-- (tests clean up with it).
CREATE FUNCTION stock_movements_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'stock_movements are immutable: % is not allowed', TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "stock_movements_immutable"
    BEFORE UPDATE OR DELETE ON "stock_movements"
    FOR EACH ROW EXECUTE FUNCTION stock_movements_reject_change();
