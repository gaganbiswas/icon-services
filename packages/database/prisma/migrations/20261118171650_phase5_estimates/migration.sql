-- CreateEnum
CREATE TYPE "estimate_status" AS ENUM ('DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "estimate_line_type" AS ENUM ('LABOUR', 'PART', 'SERVICE_FEE', 'OTHER');

-- CreateEnum
CREATE TYPE "coverage" AS ENUM ('CUSTOMER_PAY', 'WARRANTY', 'GOODWILL');

-- CreateEnum
CREATE TYPE "decision_method" AS ENUM ('CUSTOMER_APP', 'APPROVAL_LINK');

-- CreateTable
CREATE TABLE "estimates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "estimate_status" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL,
    "subtotal" DECIMAL(19,4) NOT NULL,
    "discount_total" DECIMAL(19,4) NOT NULL,
    "total" DECIMAL(19,4) NOT NULL,
    "customer_payable" DECIMAL(19,4) NOT NULL,
    "covered" DECIMAL(19,4) NOT NULL,
    "tax_treatment" VARCHAR(30) NOT NULL DEFAULT 'NOT_CONFIGURED',
    "valid_until" DATE,
    "terms" VARCHAR(4000) NOT NULL,
    "notes" VARCHAR(2000),
    "prepared_by_id" UUID NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "sent_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "estimates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimate_lines" (
    "id" UUID NOT NULL,
    "estimate_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "line_type" "estimate_line_type" NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "sku" VARCHAR(60),
    "quantity" DECIMAL(19,4) NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "unit_price" DECIMAL(19,4) NOT NULL,
    "discount" DECIMAL(19,4) NOT NULL,
    "coverage" "coverage" NOT NULL,
    "line_total" DECIMAL(19,4) NOT NULL,
    "tax_treatment" VARCHAR(30) NOT NULL DEFAULT 'NOT_CONFIGURED',

    CONSTRAINT "estimate_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimate_decisions" (
    "id" UUID NOT NULL,
    "estimate_id" UUID NOT NULL,
    "decision" "estimate_status" NOT NULL,
    "method" "decision_method" NOT NULL,
    "customer_id" UUID NOT NULL,
    "estimate_version" INTEGER NOT NULL,
    "customer_payable" DECIMAL(19,4) NOT NULL,
    "terms_accepted" BOOLEAN NOT NULL,
    "terms_hash" CHAR(64) NOT NULL,
    "comment" VARCHAR(1000),
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estimate_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimate_approval_links" (
    "id" UUID NOT NULL,
    "estimate_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estimate_approval_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "estimates_organization_id_status_idx" ON "estimates"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "estimates_job_id_version_key" ON "estimates"("job_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "estimate_lines_estimate_id_position_key" ON "estimate_lines"("estimate_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "estimate_decisions_estimate_id_key" ON "estimate_decisions"("estimate_id");

-- CreateIndex
CREATE UNIQUE INDEX "estimate_approval_links_token_hash_key" ON "estimate_approval_links"("token_hash");

-- CreateIndex
CREATE INDEX "estimate_approval_links_estimate_id_idx" ON "estimate_approval_links"("estimate_id");

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "service_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_lines" ADD CONSTRAINT "estimate_lines_estimate_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "estimates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_decisions" ADD CONSTRAINT "estimate_decisions_estimate_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "estimates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_approval_links" ADD CONSTRAINT "estimate_approval_links_estimate_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "estimates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints (Phase 5, ADR 0014)
-- ---------------------------------------------------------------------------

-- At most one open (DRAFT or SENT) estimate per job.
CREATE UNIQUE INDEX "estimates_one_open_per_job"
  ON "estimates" ("job_id")
  WHERE "status" IN ('DRAFT', 'SENT');

ALTER TABLE "estimates"
  ADD CONSTRAINT "estimates_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "estimates_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "estimates_amounts_non_negative" CHECK (
    "subtotal" >= 0 AND "discount_total" >= 0 AND "total" >= 0 AND "customer_payable" >= 0 AND "covered" >= 0
  ),
  ADD CONSTRAINT "estimates_totals_consistent" CHECK (
    "total" = "subtotal" - "discount_total" AND "total" = "customer_payable" + "covered"
  ),
  ADD CONSTRAINT "estimates_sent_fields" CHECK (
    ("status" = 'DRAFT') = ("sent_at" IS NULL) AND ("status" = 'DRAFT' OR "valid_until" IS NOT NULL)
  ),
  ADD CONSTRAINT "estimates_decided_fields" CHECK (
    ("status" IN ('APPROVED', 'REJECTED')) = ("decided_at" IS NOT NULL)
  );

ALTER TABLE "estimate_lines"
  ADD CONSTRAINT "estimate_lines_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "estimate_lines_amounts" CHECK (
    "unit_price" >= 0 AND "discount" >= 0 AND "line_total" = "quantity" * "unit_price" - "discount" AND "line_total" >= 0
  );

ALTER TABLE "estimate_decisions"
  ADD CONSTRAINT "estimate_decisions_kind" CHECK ("decision" IN ('APPROVED', 'REJECTED')),
  ADD CONSTRAINT "estimate_decisions_terms" CHECK ("decision" = 'REJECTED' OR "terms_accepted"),
  ADD CONSTRAINT "estimate_decisions_hash_format" CHECK ("terms_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "estimate_approval_links"
  ADD CONSTRAINT "estimate_approval_links_hash_format" CHECK ("token_hash" ~ '^[0-9a-f]{64}$');

-- Sent estimates are immutable: only status, decision time and row version may change,
-- and only along allowed status paths. Lines of non-draft estimates cannot change.
CREATE FUNCTION "estimates_guard_immutable"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'estimates cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."status" <> 'DRAFT' THEN
    IF (NEW."currency", NEW."subtotal", NEW."discount_total", NEW."total", NEW."customer_payable", NEW."covered",
        NEW."valid_until", NEW."terms", NEW."notes", NEW."version", NEW."job_id", NEW."sent_at", NEW."sent_by_id",
        NEW."prepared_by_id", NEW."tax_treatment")
       IS DISTINCT FROM
       (OLD."currency", OLD."subtotal", OLD."discount_total", OLD."total", OLD."customer_payable", OLD."covered",
        OLD."valid_until", OLD."terms", OLD."notes", OLD."version", OLD."job_id", OLD."sent_at", OLD."sent_by_id",
        OLD."prepared_by_id", OLD."tax_treatment") THEN
      RAISE EXCEPTION 'sent estimates are immutable; create a new version' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT (
      (OLD."status" = 'SENT' AND NEW."status" IN ('SENT', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN')) OR
      (OLD."status" = NEW."status")
    ) THEN
      RAISE EXCEPTION 'invalid estimate status change % -> %', OLD."status", NEW."status" USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "estimates_immutable_after_send"
  BEFORE UPDATE OR DELETE ON "estimates"
  FOR EACH ROW EXECUTE FUNCTION "estimates_guard_immutable"();

CREATE FUNCTION "estimate_lines_guard_draft_only"() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  parent_status "estimate_status";
BEGIN
  SELECT "status" INTO parent_status FROM "estimates"
    WHERE "id" = COALESCE(NEW."estimate_id", OLD."estimate_id");
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'lines of a sent estimate cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER "estimate_lines_draft_only"
  BEFORE INSERT OR UPDATE OR DELETE ON "estimate_lines"
  FOR EACH ROW EXECUTE FUNCTION "estimate_lines_guard_draft_only"();

CREATE TRIGGER "estimate_decisions_no_update_or_delete"
  BEFORE UPDATE OR DELETE ON "estimate_decisions"
  FOR EACH ROW EXECUTE FUNCTION "append_only_prevent_modification"();
