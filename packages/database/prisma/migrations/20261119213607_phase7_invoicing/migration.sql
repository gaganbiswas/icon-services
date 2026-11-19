-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "supply_type" AS ENUM ('INTRA_STATE', 'INTER_STATE');

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "source_estimate_id" UUID,
    "status" "invoice_status" NOT NULL DEFAULT 'DRAFT',
    "invoice_number" VARCHAR(16),
    "financial_year" VARCHAR(9),
    "invoice_date" DATE,
    "currency" CHAR(3) NOT NULL,
    "supply_type" "supply_type" NOT NULL,
    "place_of_supply_code" CHAR(2) NOT NULL,
    "reverse_charge" BOOLEAN NOT NULL DEFAULT false,
    "supplier" JSONB,
    "recipient" JSONB NOT NULL,
    "taxable_total" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "cgst_total" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "sgst_total" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "igst_total" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "round_off" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "credited_total" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "allocated_total" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "notes" VARCHAR(1000),
    "terms" VARCHAR(2000),
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "issued_at" TIMESTAMPTZ(3),
    "issued_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "line_type" "estimate_line_type" NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "hsn_sac" VARCHAR(8) NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "unit_price" DECIMAL(19,4) NOT NULL,
    "discount" DECIMAL(19,4) NOT NULL,
    "taxable_value" DECIMAL(19,4) NOT NULL,
    "tax_category" VARCHAR(30) NOT NULL,
    "gst_rate" DECIMAL(6,3) NOT NULL,
    "cgst_rate" DECIMAL(6,3) NOT NULL,
    "sgst_rate" DECIMAL(6,3) NOT NULL,
    "igst_rate" DECIMAL(6,3) NOT NULL,
    "cgst_amount" DECIMAL(19,4) NOT NULL,
    "sgst_amount" DECIMAL(19,4) NOT NULL,
    "igst_amount" DECIMAL(19,4) NOT NULL,
    "line_total" DECIMAL(19,4) NOT NULL,
    "credited_quantity" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "source_estimate_line_id" UUID,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_tax_summaries" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "hsn_sac" VARCHAR(8) NOT NULL,
    "gst_rate" DECIMAL(6,3) NOT NULL,
    "taxable_value" DECIMAL(19,4) NOT NULL,
    "cgst_amount" DECIMAL(19,4) NOT NULL,
    "sgst_amount" DECIMAL(19,4) NOT NULL,
    "igst_amount" DECIMAL(19,4) NOT NULL,

    CONSTRAINT "invoice_tax_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "credit_note_number" VARCHAR(16) NOT NULL,
    "financial_year" VARCHAR(9) NOT NULL,
    "note_date" DATE NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "is_full" BOOLEAN NOT NULL,
    "taxable_total" DECIMAL(19,4) NOT NULL,
    "cgst_total" DECIMAL(19,4) NOT NULL,
    "sgst_total" DECIMAL(19,4) NOT NULL,
    "igst_total" DECIMAL(19,4) NOT NULL,
    "round_off" DECIMAL(19,4) NOT NULL,
    "total" DECIMAL(19,4) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note_lines" (
    "id" UUID NOT NULL,
    "credit_note_id" UUID NOT NULL,
    "invoice_line_id" UUID NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL,
    "taxable_value" DECIMAL(19,4) NOT NULL,
    "cgst_amount" DECIMAL(19,4) NOT NULL,
    "sgst_amount" DECIMAL(19,4) NOT NULL,
    "igst_amount" DECIMAL(19,4) NOT NULL,
    "line_total" DECIMAL(19,4) NOT NULL,

    CONSTRAINT "credit_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ(3),
    "released_by_id" UUID,
    "release_reason" VARCHAR(500),

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_job_id_idx" ON "invoices"("job_id");

-- CreateIndex
CREATE INDEX "invoices_organization_id_branch_id_invoice_date_idx" ON "invoices"("organization_id", "branch_id", "invoice_date");

-- CreateIndex
CREATE INDEX "invoices_organization_id_customer_id_idx" ON "invoices"("organization_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organization_id_invoice_number_key" ON "invoices"("organization_id", "invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_invoice_id_position_key" ON "invoice_lines"("invoice_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_tax_summaries_invoice_id_hsn_sac_gst_rate_key" ON "invoice_tax_summaries"("invoice_id", "hsn_sac", "gst_rate");

-- CreateIndex
CREATE INDEX "credit_notes_invoice_id_idx" ON "credit_notes"("invoice_id");

-- CreateIndex
CREATE INDEX "credit_notes_organization_id_note_date_idx" ON "credit_notes"("organization_id", "note_date");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_organization_id_credit_note_number_key" ON "credit_notes"("organization_id", "credit_note_number");

-- CreateIndex
CREATE INDEX "credit_note_lines_credit_note_id_idx" ON "credit_note_lines"("credit_note_id");

-- CreateIndex
CREATE INDEX "payment_allocations_payment_id_idx" ON "payment_allocations"("payment_id");

-- CreateIndex
CREATE INDEX "payment_allocations_invoice_id_idx" ON "payment_allocations"("invoice_id");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "service_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_tax_summaries" ADD CONSTRAINT "invoice_tax_summaries_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "credit_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Phase 7 integrity rules (ADR 0022)
-- ---------------------------------------------------------------------------

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_org_branch_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "invoices_org_customer_fkey" FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "invoices_org_job_fkey" FOREIGN KEY ("organization_id", "job_id") REFERENCES "service_jobs"("organization_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "invoices_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "invoices_number_format" CHECK ("invoice_number" IS NULL OR "invoice_number" ~ '^[A-Za-z0-9/-]{1,16}$'),
  ADD CONSTRAINT "invoices_totals_add_up" CHECK (
    "tax_total" = "cgst_total" + "sgst_total" + "igst_total" AND
    "total" = "taxable_total" + "tax_total" + "round_off"
  ),
  ADD CONSTRAINT "invoices_supply_type_taxes" CHECK (
    ("supply_type" = 'INTRA_STATE' AND "igst_total" = 0) OR
    ("supply_type" = 'INTER_STATE' AND "cgst_total" = 0 AND "sgst_total" = 0)
  ),
  ADD CONSTRAINT "invoices_running_totals" CHECK (
    "credited_total" >= 0 AND "allocated_total" >= 0 AND "credited_total" + "allocated_total" <= "total"
  ),
  ADD CONSTRAINT "invoices_issue_consistent" CHECK (
    ("status" = 'DRAFT' AND "invoice_number" IS NULL AND "issued_at" IS NULL AND "credited_total" = 0 AND "allocated_total" = 0)
    OR ("status" <> 'DRAFT' AND "invoice_number" IS NOT NULL AND "financial_year" IS NOT NULL AND "invoice_date" IS NOT NULL
        AND "issued_at" IS NOT NULL AND "issued_by_id" IS NOT NULL AND "supplier" IS NOT NULL AND "total" > 0)
  ),
  ADD CONSTRAINT "invoices_cancel_consistent" CHECK (
    ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL) AND ("status" <> 'CANCELLED' OR "credited_total" = "total")
  );

ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_values" CHECK (
    "quantity" > 0 AND "unit_price" >= 0 AND "discount" >= 0 AND "taxable_value" >= 0 AND
    "credited_quantity" >= 0 AND "credited_quantity" <= "quantity" AND
    "line_total" = "taxable_value" + "cgst_amount" + "sgst_amount" + "igst_amount"
  );

ALTER TABLE "credit_notes"
  ADD CONSTRAINT "credit_notes_number_format" CHECK ("credit_note_number" ~ '^[A-Za-z0-9/-]{1,16}$'),
  ADD CONSTRAINT "credit_notes_totals" CHECK ("total" > 0 AND "total" = "taxable_total" + "cgst_total" + "sgst_total" + "igst_total" + "round_off");

ALTER TABLE "payment_allocations"
  ADD CONSTRAINT "payment_allocations_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "payment_allocations_release_consistent" CHECK (
    ("released_at" IS NULL) = ("released_by_id" IS NULL) AND ("released_at" IS NULL) = ("release_reason" IS NULL)
  );

-- One open draft per job at a time.
CREATE UNIQUE INDEX "invoices_one_draft_per_job" ON "invoices" ("job_id") WHERE "status" = 'DRAFT';

-- Issued invoices are immutable except their running totals and cancellation; only drafts may be deleted.
CREATE FUNCTION "invoices_guard_issued"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'issued invoices cannot be deleted; issue a credit note' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'DRAFT' THEN
    IF (NEW."organization_id", NEW."branch_id", NEW."job_id", NEW."customer_id", NEW."invoice_number", NEW."financial_year",
        NEW."invoice_date", NEW."currency", NEW."supply_type", NEW."place_of_supply_code", NEW."reverse_charge", NEW."supplier",
        NEW."recipient", NEW."taxable_total", NEW."cgst_total", NEW."sgst_total", NEW."igst_total", NEW."tax_total",
        NEW."round_off", NEW."total", NEW."notes", NEW."terms", NEW."issued_at", NEW."issued_by_id", NEW."created_at")
       IS DISTINCT FROM
       (OLD."organization_id", OLD."branch_id", OLD."job_id", OLD."customer_id", OLD."invoice_number", OLD."financial_year",
        OLD."invoice_date", OLD."currency", OLD."supply_type", OLD."place_of_supply_code", OLD."reverse_charge", OLD."supplier",
        OLD."recipient", OLD."taxable_total", OLD."cgst_total", OLD."sgst_total", OLD."igst_total", OLD."tax_total",
        OLD."round_off", OLD."total", OLD."notes", OLD."terms", OLD."issued_at", OLD."issued_by_id", OLD."created_at") THEN
      RAISE EXCEPTION 'issued invoices cannot change; issue a credit note' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD."status" = 'CANCELLED' AND NEW."status" <> 'CANCELLED' THEN
      RAISE EXCEPTION 'cancelled invoices cannot be reopened' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW."status" = 'DRAFT' THEN
      RAISE EXCEPTION 'issued invoices cannot return to draft' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "invoices_guard_issued"
  BEFORE UPDATE OR DELETE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION "invoices_guard_issued"();

-- Lines change only while the invoice is a draft (credited quantity may grow afterwards).
CREATE FUNCTION "invoice_lines_guard"() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  parent_status "invoice_status";
BEGIN
  SELECT "status" INTO parent_status FROM "invoices" WHERE "id" = COALESCE(NEW."invoice_id", OLD."invoice_id");
  IF parent_status = 'DRAFT' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'credited_quantity') = (to_jsonb(OLD) - 'credited_quantity')
     AND NEW."credited_quantity" >= OLD."credited_quantity" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'lines of an issued invoice cannot change' USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "invoice_lines_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "invoice_lines"
  FOR EACH ROW EXECUTE FUNCTION "invoice_lines_guard"();

CREATE TRIGGER "invoice_tax_summaries_append_only"
  BEFORE UPDATE OR DELETE ON "invoice_tax_summaries"
  FOR EACH ROW EXECUTE FUNCTION "append_only_prevent_modification"();

CREATE TRIGGER "credit_notes_append_only"
  BEFORE UPDATE OR DELETE ON "credit_notes"
  FOR EACH ROW EXECUTE FUNCTION "append_only_prevent_modification"();

CREATE TRIGGER "credit_note_lines_append_only"
  BEFORE UPDATE OR DELETE ON "credit_note_lines"
  FOR EACH ROW EXECUTE FUNCTION "append_only_prevent_modification"();

-- Allocations are released, never deleted or edited.
CREATE FUNCTION "payment_allocations_guard"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'allocations cannot be deleted; release them' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."released_at" IS NOT NULL
     OR (NEW."organization_id", NEW."payment_id", NEW."invoice_id", NEW."amount", NEW."created_by_id", NEW."created_at")
        IS DISTINCT FROM (OLD."organization_id", OLD."payment_id", OLD."invoice_id", OLD."amount", OLD."created_by_id", OLD."created_at") THEN
    RAISE EXCEPTION 'allocations can only be released once' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payment_allocations_guard"
  BEFORE UPDATE OR DELETE ON "payment_allocations"
  FOR EACH ROW EXECUTE FUNCTION "payment_allocations_guard"();
