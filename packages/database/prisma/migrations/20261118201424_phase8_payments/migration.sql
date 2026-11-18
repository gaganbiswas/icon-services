-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('CASH', 'UPI', 'BANK_TRANSFER', 'CARD_TERMINAL', 'CHEQUE', 'OTHER');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('RECORDED', 'REVERSED');

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "receipt_number" VARCHAR(40) NOT NULL,
    "customer_id" UUID NOT NULL,
    "job_id" UUID,
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "method" "payment_method" NOT NULL,
    "reference" VARCHAR(100),
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "received_by_id" UUID NOT NULL,
    "notes" VARCHAR(500),
    "status" "payment_status" NOT NULL DEFAULT 'RECORDED',
    "allocated_total" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "refunded_total" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "reversed_at" TIMESTAMPTZ(3),
    "reversed_by_id" UUID,
    "reversal_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_refunds" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "refund_number" VARCHAR(40) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "method" "payment_method" NOT NULL,
    "reference" VARCHAR(100),
    "reason" VARCHAR(500) NOT NULL,
    "approved_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_organization_id_customer_id_idx" ON "payments"("organization_id", "customer_id");

-- CreateIndex
CREATE INDEX "payments_job_id_idx" ON "payments"("job_id");

-- CreateIndex
CREATE INDEX "payments_organization_id_branch_id_received_at_idx" ON "payments"("organization_id", "branch_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_organization_id_receipt_number_key" ON "payments"("organization_id", "receipt_number");

-- CreateIndex
CREATE INDEX "payment_refunds_payment_id_idx" ON "payment_refunds"("payment_id");

-- CreateIndex
CREATE INDEX "payment_refunds_organization_id_branch_id_created_at_idx" ON "payment_refunds"("organization_id", "branch_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_refunds_organization_id_refund_number_key" ON "payment_refunds"("organization_id", "refund_number");

-- AddForeignKey
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints (Phase 8, ADR 0016)
-- ---------------------------------------------------------------------------

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "payments_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "payments_totals_bounded" CHECK (
    "allocated_total" >= 0 AND "refunded_total" >= 0 AND "allocated_total" + "refunded_total" <= "amount"
  ),
  ADD CONSTRAINT "payments_reference_required" CHECK ("method" = 'CASH' OR "reference" IS NOT NULL),
  ADD CONSTRAINT "payments_reversal_consistent" CHECK (
    ("status" = 'REVERSED') = ("reversed_at" IS NOT NULL) AND
    ("status" = 'REVERSED') = ("reversal_reason" IS NOT NULL) AND
    ("status" <> 'REVERSED' OR ("allocated_total" = 0 AND "refunded_total" = 0))
  );

ALTER TABLE "payment_refunds"
  ADD CONSTRAINT "payment_refunds_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "payment_refunds_reference_required" CHECK ("method" = 'CASH' OR "reference" IS NOT NULL);

-- Recorded payments are immutable except for running totals and reversal fields.
CREATE FUNCTION "payments_guard_immutable"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments cannot be deleted; reverse them instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW."organization_id", NEW."branch_id", NEW."receipt_number", NEW."customer_id", NEW."job_id", NEW."currency",
      NEW."amount", NEW."method", NEW."reference", NEW."received_at", NEW."received_by_id", NEW."notes", NEW."created_at")
     IS DISTINCT FROM
     (OLD."organization_id", OLD."branch_id", OLD."receipt_number", OLD."customer_id", OLD."job_id", OLD."currency",
      OLD."amount", OLD."method", OLD."reference", OLD."received_at", OLD."received_by_id", OLD."notes", OLD."created_at") THEN
    RAISE EXCEPTION 'recorded payments are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."status" = 'REVERSED' THEN
    RAISE EXCEPTION 'reversed payments cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payments_immutable"
  BEFORE UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "payments_guard_immutable"();

CREATE TRIGGER "payment_refunds_no_update_or_delete"
  BEFORE UPDATE OR DELETE ON "payment_refunds"
  FOR EACH ROW EXECUTE FUNCTION "append_only_prevent_modification"();
