-- CreateEnum
CREATE TYPE "work_log_visibility" AS ENUM ('INTERNAL', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "outbox_status" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD', 'SKIPPED');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('ACCEPTED', 'FAILED', 'SKIPPED_NO_CONSENT', 'SKIPPED_NO_ADDRESS', 'DELIVERED', 'READ');

-- AlterTable
ALTER TABLE "service_jobs" ADD COLUMN     "completed_at" TIMESTAMPTZ(3),
ADD COLUMN     "completed_by_id" UUID,
ADD COLUMN     "qc_checklist" JSONB,
ADD COLUMN     "repair_summary" VARCHAR(4000);

-- CreateTable
CREATE TABLE "job_assignments" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "technician_user_id" UUID NOT NULL,
    "assigned_by_id" UUID NOT NULL,
    "note" VARCHAR(500),
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "ended_by_id" UUID,

    CONSTRAINT "job_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnoses" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "technician_user_id" UUID NOT NULL,
    "symptom" VARCHAR(2000) NOT NULL,
    "findings" VARCHAR(4000) NOT NULL,
    "root_cause" VARCHAR(2000),
    "recommendation" VARCHAR(2000),
    "internal_notes" VARCHAR(4000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_logs" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "description" VARCHAR(4000) NOT NULL,
    "duration_minutes" INTEGER,
    "visibility" "work_log_visibility" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "event_type" VARCHAR(50) NOT NULL,
    "aggregate_type" VARCHAR(50) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "outbox_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(3),
    "last_error" VARCHAR(200),
    "idempotency_key" VARCHAR(150) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "outbox_id" UUID NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "template_name" VARCHAR(100) NOT NULL,
    "status" "delivery_status" NOT NULL,
    "provider_message_id" VARCHAR(200),
    "error_code" VARCHAR(100),
    "attempt" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_assignments_job_id_idx" ON "job_assignments"("job_id");

-- CreateIndex
CREATE INDEX "job_assignments_technician_user_id_ended_at_idx" ON "job_assignments"("technician_user_id", "ended_at");

-- CreateIndex
CREATE INDEX "diagnoses_job_id_created_at_idx" ON "diagnoses"("job_id", "created_at");

-- CreateIndex
CREATE INDEX "work_logs_job_id_created_at_idx" ON "work_logs"("job_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_outbox_idempotency_key_key" ON "notification_outbox"("idempotency_key");

-- CreateIndex
CREATE INDEX "notification_outbox_status_next_attempt_at_idx" ON "notification_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "notification_outbox_organization_id_created_at_idx" ON "notification_outbox"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notification_outbox_aggregate_type_aggregate_id_idx" ON "notification_outbox"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "notification_deliveries_outbox_id_idx" ON "notification_deliveries"("outbox_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_outbox_id_channel_attempt_key" ON "notification_deliveries"("outbox_id", "channel", "attempt");

-- AddForeignKey
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "service_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_technician_user_id_fkey" FOREIGN KEY ("technician_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "service_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_technician_user_id_fkey" FOREIGN KEY ("technician_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "service_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "notification_outbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints (Phase 4)
-- ---------------------------------------------------------------------------

-- At most one active assignment per technician per job.
CREATE UNIQUE INDEX "job_assignments_one_active"
  ON "job_assignments" ("job_id", "technician_user_id")
  WHERE "ended_at" IS NULL;

ALTER TABLE "job_assignments"
  ADD CONSTRAINT "job_assignments_end_after_start" CHECK ("ended_at" IS NULL OR "ended_at" >= "assigned_at");

ALTER TABLE "work_logs"
  ADD CONSTRAINT "work_logs_duration_range" CHECK ("duration_minutes" IS NULL OR "duration_minutes" BETWEEN 1 AND 1440),
  ADD CONSTRAINT "work_logs_customer_length" CHECK ("visibility" = 'INTERNAL' OR char_length("description") <= 500);

-- REPAIR_COMPLETED and later states require a completion record.
ALTER TABLE "service_jobs"
  ADD CONSTRAINT "service_jobs_completion_consistent" CHECK (
    ("completed_at" IS NULL) = ("repair_summary" IS NULL) AND
    ("completed_at" IS NULL) = ("qc_checklist" IS NULL)
  );

ALTER TABLE "notification_outbox"
  ADD CONSTRAINT "notification_outbox_attempts" CHECK ("attempts" >= 0);

-- Diagnoses and work logs are part of the job record: append-only.
CREATE FUNCTION "append_only_prevent_modification"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "diagnoses_no_update_or_delete"
  BEFORE UPDATE OR DELETE ON "diagnoses"
  FOR EACH ROW EXECUTE FUNCTION "append_only_prevent_modification"();

CREATE TRIGGER "work_logs_no_update_or_delete"
  BEFORE UPDATE OR DELETE ON "work_logs"
  FOR EACH ROW EXECUTE FUNCTION "append_only_prevent_modification"();
