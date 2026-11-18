-- CreateEnum
CREATE TYPE "stock_movement_type" AS ENUM ('RECEIVE', 'ADJUST', 'TRANSFER_OUT', 'TRANSFER_IN', 'RESERVE', 'RELEASE', 'CONSUME', 'RETURN');

-- CreateEnum
CREATE TYPE "removed_part_disposition" AS ENUM ('RETURNED_TO_CUSTOMER', 'SENT_TO_VENDOR', 'SCRAPPED', 'KEPT_FOR_WARRANTY_CLAIM');

-- CreateTable
CREATE TABLE "parts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "sku" VARCHAR(60) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(1000),
    "category" VARCHAR(100),
    "unit" VARCHAR(20) NOT NULL,
    "reorder_level" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "selling_price" DECIMAL(19,4),
    "tax_category" VARCHAR(50),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(32),
    "email" VARCHAR(254),
    "notes" VARCHAR(1000),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_stock" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "on_hand" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "reorder_level" DECIMAL(19,4),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branch_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "type" "stock_movement_type" NOT NULL,
    "on_hand_delta" DECIMAL(19,4) NOT NULL,
    "reserved_delta" DECIMAL(19,4) NOT NULL,
    "unit_cost" DECIMAL(19,4),
    "supplier_id" UUID,
    "job_id" UUID,
    "transfer_id" UUID,
    "reference" VARCHAR(100),
    "reason" VARCHAR(500),
    "negative_override" BOOLEAN NOT NULL DEFAULT false,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_parts" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "reserved" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "consumed" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "returned" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "removed_part_description" VARCHAR(300),
    "removed_part_serial" VARCHAR(100),
    "disposition" "removed_part_disposition",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_parts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parts_organization_id_sku_key" ON "parts"("organization_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "parts_organization_id_id_key" ON "parts"("organization_id", "id");

-- CreateIndex
CREATE INDEX "suppliers_organization_id_idx" ON "suppliers"("organization_id");

-- CreateIndex
CREATE INDEX "branch_stock_organization_id_part_id_idx" ON "branch_stock"("organization_id", "part_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_stock_branch_id_part_id_key" ON "branch_stock"("branch_id", "part_id");

-- CreateIndex
CREATE INDEX "stock_movements_branch_id_part_id_created_at_idx" ON "stock_movements"("branch_id", "part_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_job_id_idx" ON "stock_movements"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_parts_job_id_part_id_key" ON "job_parts"("job_id", "part_id");

-- AddForeignKey
ALTER TABLE "branch_stock" ADD CONSTRAINT "branch_stock_organization_id_part_id_fkey" FOREIGN KEY ("organization_id", "part_id") REFERENCES "parts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_part_id_fkey" FOREIGN KEY ("organization_id", "part_id") REFERENCES "parts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_parts" ADD CONSTRAINT "job_parts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "service_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_parts" ADD CONSTRAINT "job_parts_organization_id_part_id_fkey" FOREIGN KEY ("organization_id", "part_id") REFERENCES "parts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints (Phase 6, ADR 0015)
-- ---------------------------------------------------------------------------

ALTER TABLE "parts"
  ADD CONSTRAINT "parts_sku_format" CHECK ("sku" ~ '^[A-Z0-9][A-Z0-9._/-]{0,59}$'),
  ADD CONSTRAINT "parts_amounts" CHECK ("reorder_level" >= 0 AND ("selling_price" IS NULL OR "selling_price" >= 0)),
  ADD CONSTRAINT "parts_version_positive" CHECK ("version" >= 1);

-- Reservations can never be negative; on_hand may go negative only through an
-- audited override (enforced in the service), so it has no CHECK.
ALTER TABLE "branch_stock"
  ADD CONSTRAINT "branch_stock_reserved_non_negative" CHECK ("reserved" >= 0),
  ADD CONSTRAINT "branch_stock_reorder_non_negative" CHECK ("reorder_level" IS NULL OR "reorder_level" >= 0);

-- Movement direction must match its type.
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_direction" CHECK (
    ("type" = 'RECEIVE'      AND "on_hand_delta" > 0 AND "reserved_delta" = 0) OR
    ("type" = 'ADJUST'       AND "on_hand_delta" <> 0 AND "reserved_delta" = 0) OR
    ("type" = 'TRANSFER_OUT' AND "on_hand_delta" < 0 AND "reserved_delta" = 0) OR
    ("type" = 'TRANSFER_IN'  AND "on_hand_delta" > 0 AND "reserved_delta" = 0) OR
    ("type" = 'RESERVE'      AND "on_hand_delta" = 0 AND "reserved_delta" > 0) OR
    ("type" = 'RELEASE'      AND "on_hand_delta" = 0 AND "reserved_delta" < 0) OR
    ("type" = 'CONSUME'      AND "on_hand_delta" < 0 AND "reserved_delta" <= 0) OR
    ("type" = 'RETURN'       AND "on_hand_delta" > 0 AND "reserved_delta" = 0)
  ),
  ADD CONSTRAINT "stock_movements_reason_required" CHECK ("type" <> 'ADJUST' OR "reason" IS NOT NULL),
  ADD CONSTRAINT "stock_movements_override_reason" CHECK (NOT "negative_override" OR "reason" IS NOT NULL),
  ADD CONSTRAINT "stock_movements_job_types" CHECK ("type" NOT IN ('RESERVE', 'RELEASE', 'CONSUME', 'RETURN') OR "job_id" IS NOT NULL),
  ADD CONSTRAINT "stock_movements_unit_cost" CHECK ("unit_cost" IS NULL OR "unit_cost" >= 0);

ALTER TABLE "job_parts"
  ADD CONSTRAINT "job_parts_quantities" CHECK ("reserved" >= 0 AND "consumed" >= 0 AND "returned" >= 0);

CREATE TRIGGER "stock_movements_no_update_or_delete"
  BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION "append_only_prevent_modification"();
