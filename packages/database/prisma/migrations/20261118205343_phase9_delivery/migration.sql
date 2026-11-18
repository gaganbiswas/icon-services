-- CreateEnum
CREATE TYPE "delivery_mode" AS ENUM ('CUSTOMER_PICKUP', 'HOME_DELIVERY', 'ON_SITE_RETURN', 'OTHER');

-- CreateEnum
CREATE TYPE "delivery_record_status" AS ENUM ('DISPATCHED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "recipient_relationship" AS ENUM ('SELF', 'AUTHORIZED_PERSON', 'FAMILY', 'COLLEAGUE', 'OTHER');

-- CreateEnum
CREATE TYPE "proof_method" AS ENUM ('SIGNED_CHALLAN', 'PHOTO_PROOF');

-- CreateTable
CREATE TABLE "deliveries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "challan_number" VARCHAR(40) NOT NULL,
    "mode" "delivery_mode" NOT NULL,
    "status" "delivery_record_status" NOT NULL,
    "address" JSONB,
    "dispatched_at" TIMESTAMPTZ(3),
    "dispatched_by_id" UUID,
    "recipient_name" VARCHAR(200),
    "relationship" "recipient_relationship",
    "authorization_note" VARCHAR(500),
    "checklist" JSONB,
    "condition_notes" VARCHAR(1000),
    "proof_method" "proof_method",
    "proof_file_id" UUID,
    "balance_snapshot" JSONB,
    "due_override_reason" VARCHAR(500),
    "due_override_by_id" UUID,
    "delivered_at" TIMESTAMPTZ(3),
    "delivered_by_id" UUID,
    "failed_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_items" (
    "id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "returned" BOOLEAN NOT NULL,
    "condition" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deliveries_job_id_idx" ON "deliveries"("job_id");

-- CreateIndex
CREATE INDEX "deliveries_organization_id_branch_id_delivered_at_idx" ON "deliveries"("organization_id", "branch_id", "delivered_at");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_organization_id_challan_number_key" ON "deliveries"("organization_id", "challan_number");

-- CreateIndex
CREATE INDEX "delivery_items_delivery_id_idx" ON "delivery_items"("delivery_id");

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "service_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints (Phase 9, ADR 0017)
-- ---------------------------------------------------------------------------

-- At most one open (dispatched) delivery and one completed delivery per job.
CREATE UNIQUE INDEX "deliveries_one_open_per_job" ON "deliveries" ("job_id") WHERE "status" = 'DISPATCHED';
CREATE UNIQUE INDEX "deliveries_one_completed_per_job" ON "deliveries" ("job_id") WHERE "status" = 'COMPLETED';

ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_completed_record" CHECK (
    "status" <> 'COMPLETED' OR (
      "recipient_name" IS NOT NULL AND "relationship" IS NOT NULL AND "proof_method" IS NOT NULL AND
      "delivered_at" IS NOT NULL AND "delivered_by_id" IS NOT NULL AND "balance_snapshot" IS NOT NULL AND
      ("relationship" = 'SELF' OR "authorization_note" IS NOT NULL) AND
      ("proof_method" <> 'PHOTO_PROOF' OR "proof_file_id" IS NOT NULL)
    )
  ),
  ADD CONSTRAINT "deliveries_dispatch_fields" CHECK (
    "mode" NOT IN ('HOME_DELIVERY') OR "address" IS NOT NULL
  ),
  ADD CONSTRAINT "deliveries_override_consistent" CHECK (("due_override_reason" IS NULL) = ("due_override_by_id" IS NULL)),
  ADD CONSTRAINT "deliveries_failed_reason" CHECK ("status" <> 'FAILED' OR "failed_reason" IS NOT NULL);

-- Completed deliveries are final records.
CREATE FUNCTION "deliveries_guard_completed"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'deliveries cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."status" IN ('COMPLETED', 'FAILED') THEN
    RAISE EXCEPTION 'completed or failed deliveries cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "deliveries_final"
  BEFORE UPDATE OR DELETE ON "deliveries"
  FOR EACH ROW EXECUTE FUNCTION "deliveries_guard_completed"();

CREATE TRIGGER "delivery_items_no_update_or_delete"
  BEFORE UPDATE OR DELETE ON "delivery_items"
  FOR EACH ROW EXECUTE FUNCTION "append_only_prevent_modification"();
