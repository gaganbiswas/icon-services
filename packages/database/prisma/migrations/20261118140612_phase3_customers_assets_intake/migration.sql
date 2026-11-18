-- CreateEnum
CREATE TYPE "session_subject_type" AS ENUM ('STAFF', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "customer_type" AS ENUM ('INDIVIDUAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "customer_status" AS ENUM ('ACTIVE', 'ANONYMIZED');

-- CreateEnum
CREATE TYPE "address_kind" AS ENUM ('BILLING', 'SERVICE');

-- CreateEnum
CREATE TYPE "consent_channel" AS ENUM ('WHATSAPP', 'EMAIL', 'SMS', 'PUSH');

-- CreateEnum
CREATE TYPE "consent_purpose" AS ENUM ('SERVICE_UPDATES', 'MARKETING');

-- CreateEnum
CREATE TYPE "file_classification" AS ENUM ('PERSONAL', 'INTERNAL', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "service_type" AS ENUM ('IN_WARRANTY', 'OUT_OF_WARRANTY', 'WARRANTY_UNVERIFIED');

-- CreateEnum
CREATE TYPE "service_mode" AS ENUM ('AT_SERVICE_CENTRE', 'ON_SITE');

-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('AWAITING_DEVICE', 'RECEIVED', 'WARRANTY_CHECK', 'DIAGNOSIS', 'ESTIMATE_PREPARATION', 'AWAITING_CUSTOMER_APPROVAL', 'WAITING_FOR_PARTS', 'REPAIR_IN_PROGRESS', 'QUALITY_CHECK', 'REPAIR_COMPLETED', 'READY_FOR_DELIVERY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "warranty_verification" AS ENUM ('NOT_CHECKED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "intake_channel" AS ENUM ('STAFF', 'CUSTOMER_APP', 'WEB_PORTAL');

-- CreateEnum
CREATE TYPE "attachment_visibility" AS ENUM ('INTERNAL', 'CUSTOMER');

-- AlterTable
ALTER TABLE "auth_sessions" ADD COLUMN     "customer_id" UUID,
ADD COLUMN     "subject_type" "session_subject_type" NOT NULL DEFAULT 'STAFF',
ALTER COLUMN "user_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "business_settings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_scope" VARCHAR(36) NOT NULL,
    "document_type" VARCHAR(40) NOT NULL,
    "period_key" VARCHAR(20) NOT NULL,
    "current_value" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_key" VARCHAR(80) NOT NULL,
    "operation" VARCHAR(60) NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "resource_id" VARCHAR(100),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_code" VARCHAR(30) NOT NULL,
    "type" "customer_type" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "contact_person" VARCHAR(200),
    "phone_e164" VARCHAR(16) NOT NULL,
    "phone_display" VARCHAR(32) NOT NULL,
    "alt_phone_e164" VARCHAR(16),
    "alt_phone_display" VARCHAR(32),
    "email" VARCHAR(254),
    "tax_identifier" VARCHAR(30),
    "preferred_language" VARCHAR(20),
    "notes" VARCHAR(2000),
    "status" "customer_status" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" UUID,
    "source" VARCHAR(20) NOT NULL DEFAULT 'INTAKE_STAFF',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "anonymized_at" TIMESTAMPTZ(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "kind" "address_kind" NOT NULL,
    "line1" VARCHAR(200) NOT NULL,
    "line2" VARCHAR(200),
    "city" VARCHAR(100) NOT NULL,
    "region" VARCHAR(100),
    "postal_code" VARCHAR(20),
    "country_code" CHAR(2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_consents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "channel" "consent_channel" NOT NULL,
    "purpose" "consent_purpose" NOT NULL,
    "policy_version" VARCHAR(50) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "recorded_by_id" UUID,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawn_at" TIMESTAMPTZ(3),
    "withdrawn_source" VARCHAR(20),

    CONSTRAINT "customer_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "asset_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "brand" VARCHAR(100) NOT NULL,
    "model" VARCHAR(150) NOT NULL,
    "serial_number" VARCHAR(100),
    "serial_normalized" VARCHAR(100),
    "asset_tag" VARCHAR(100),
    "purchase_date" DATE,
    "warranty_start" DATE,
    "warranty_end" DATE,
    "warranty_provider" VARCHAR(150),
    "warranty_reference" VARCHAR(150),
    "proof_of_purchase_file_id" UUID,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "storage_key" VARCHAR(200) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "classification" "file_classification" NOT NULL,
    "uploaded_by_user_id" UUID,
    "uploaded_by_customer_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_jobs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "job_number" VARCHAR(40) NOT NULL,
    "customer_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "service_type" "service_type" NOT NULL,
    "service_mode" "service_mode" NOT NULL,
    "complaint" VARCHAR(4000) NOT NULL,
    "intake_checklist" JSONB NOT NULL DEFAULT '[]',
    "accessories_received" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "condition_notes" VARCHAR(2000),
    "service_address" JSONB,
    "channel" "intake_channel" NOT NULL,
    "status" "job_status" NOT NULL,
    "received_at" TIMESTAMPTZ(3),
    "received_by_id" UUID,
    "expected_completion_date" DATE,
    "warranty_verification" "warranty_verification" NOT NULL DEFAULT 'NOT_CHECKED',
    "warranty_verified_by_id" UUID,
    "warranty_verified_at" TIMESTAMPTZ(3),
    "warranty_notes" VARCHAR(2000),
    "customer_acknowledged_at" TIMESTAMPTZ(3),
    "acknowledgement_method" VARCHAR(30),
    "created_by_id" UUID,
    "created_by_customer_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_status_history" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "from_status" "job_status",
    "to_status" "job_status" NOT NULL,
    "actor_user_id" UUID,
    "actor_customer_id" UUID,
    "channel" VARCHAR(20) NOT NULL,
    "reason" VARCHAR(1000),
    "customer_message" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_attachments" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "visibility" "attachment_visibility" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID,
    "document_type" VARCHAR(30) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "document_number" VARCHAR(40) NOT NULL,
    "layout" VARCHAR(20) NOT NULL,
    "version" INTEGER NOT NULL,
    "file_id" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "generated_by_id" UUID,
    "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_otp_challenges" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "phone_e164" VARCHAR(16) NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_settings_organization_id_key_key" ON "business_settings"("organization_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "number_sequences_organization_id_branch_scope_document_type_key" ON "number_sequences"("organization_id", "branch_scope", "document_type", "period_key");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_actor_key_operation_key_key" ON "idempotency_keys"("actor_key", "operation", "key");

-- CreateIndex
CREATE INDEX "customers_organization_id_phone_e164_idx" ON "customers"("organization_id", "phone_e164");

-- CreateIndex
CREATE INDEX "customers_organization_id_alt_phone_e164_idx" ON "customers"("organization_id", "alt_phone_e164");

-- CreateIndex
CREATE INDEX "customers_organization_id_email_idx" ON "customers"("organization_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organization_id_customer_code_key" ON "customers"("organization_id", "customer_code");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organization_id_id_key" ON "customers"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_addresses_customer_id_kind_key" ON "customer_addresses"("customer_id", "kind");

-- CreateIndex
CREATE INDEX "customer_consents_customer_id_idx" ON "customer_consents"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_categories_organization_id_code_key" ON "asset_categories"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "asset_categories_organization_id_id_key" ON "asset_categories"("organization_id", "id");

-- CreateIndex
CREATE INDEX "assets_organization_id_serial_normalized_idx" ON "assets"("organization_id", "serial_normalized");

-- CreateIndex
CREATE INDEX "assets_customer_id_idx" ON "assets"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "assets_organization_id_id_key" ON "assets"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "files_storage_key_key" ON "files"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "files_organization_id_id_key" ON "files"("organization_id", "id");

-- CreateIndex
CREATE INDEX "service_jobs_organization_id_branch_id_status_idx" ON "service_jobs"("organization_id", "branch_id", "status");

-- CreateIndex
CREATE INDEX "service_jobs_organization_id_created_at_idx" ON "service_jobs"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "service_jobs_customer_id_idx" ON "service_jobs"("customer_id");

-- CreateIndex
CREATE INDEX "service_jobs_asset_id_idx" ON "service_jobs"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_jobs_organization_id_job_number_key" ON "service_jobs"("organization_id", "job_number");

-- CreateIndex
CREATE UNIQUE INDEX "service_jobs_organization_id_id_key" ON "service_jobs"("organization_id", "id");

-- CreateIndex
CREATE INDEX "job_status_history_job_id_created_at_idx" ON "job_status_history"("job_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "job_attachments_job_id_file_id_key" ON "job_attachments"("job_id", "file_id");

-- CreateIndex
CREATE INDEX "documents_organization_id_document_type_generated_at_idx" ON "documents"("organization_id", "document_type", "generated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "documents_entity_type_entity_id_document_type_layout_versio_key" ON "documents"("entity_type", "entity_id", "document_type", "layout", "version");

-- CreateIndex
CREATE INDEX "customer_otp_challenges_organization_id_phone_e164_created__idx" ON "customer_otp_challenges"("organization_id", "phone_e164", "created_at" DESC);

-- CreateIndex
CREATE INDEX "auth_sessions_customer_id_idx" ON "auth_sessions"("customer_id");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_organization_id_customer_id_fkey" FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_customer_id_fkey" FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_category_id_fkey" FOREIGN KEY ("organization_id", "category_id") REFERENCES "asset_categories"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_proof_of_purchase_file_id_fkey" FOREIGN KEY ("proof_of_purchase_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_jobs" ADD CONSTRAINT "service_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_jobs" ADD CONSTRAINT "service_jobs_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_jobs" ADD CONSTRAINT "service_jobs_organization_id_customer_id_fkey" FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_jobs" ADD CONSTRAINT "service_jobs_organization_id_asset_id_fkey" FOREIGN KEY ("organization_id", "asset_id") REFERENCES "assets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_status_history" ADD CONSTRAINT "job_status_history_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "service_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_attachments" ADD CONSTRAINT "job_attachments_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "service_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_attachments" ADD CONSTRAINT "job_attachments_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints (keep in sync with docs/database-dictionary.md)
-- ---------------------------------------------------------------------------

-- Sessions belong to exactly one subject (staff user or customer).
ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_single_subject" CHECK (
    ("subject_type" = 'STAFF' AND "user_id" IS NOT NULL AND "customer_id" IS NULL) OR
    ("subject_type" = 'CUSTOMER' AND "customer_id" IS NOT NULL AND "user_id" IS NULL)
  );

ALTER TABLE "number_sequences"
  ADD CONSTRAINT "number_sequences_positive" CHECK ("current_value" > 0);

ALTER TABLE "idempotency_keys"
  ADD CONSTRAINT "idempotency_keys_key_format" CHECK ("key" ~ '^[A-Za-z0-9_-]{8,100}$'),
  ADD CONSTRAINT "idempotency_keys_hash_format" CHECK ("request_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_phone_e164" CHECK ("phone_e164" ~ '^\+[1-9][0-9]{6,14}$'),
  ADD CONSTRAINT "customers_alt_phone_e164" CHECK ("alt_phone_e164" IS NULL OR "alt_phone_e164" ~ '^\+[1-9][0-9]{6,14}$'),
  ADD CONSTRAINT "customers_name_not_blank" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "customers_source" CHECK ("source" IN ('INTAKE_STAFF', 'CUSTOMER_APP', 'WEB_PORTAL')),
  ADD CONSTRAINT "customers_version_positive" CHECK ("version" >= 1);

-- Customer name search (CLAUDE.md §5: search by customer name).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "customers_name_trgm_idx" ON "customers" USING gin (lower("name") gin_trgm_ops);

ALTER TABLE "customer_addresses"
  ADD CONSTRAINT "customer_addresses_country_format" CHECK ("country_code" ~ '^[A-Z]{2}$');

ALTER TABLE "customer_consents"
  ADD CONSTRAINT "customer_consents_source" CHECK ("source" IN ('STAFF_ENTRY', 'CUSTOMER_APP', 'WEB_PORTAL'));

-- At most one active consent per customer/channel/purpose.
CREATE UNIQUE INDEX "customer_consents_one_active"
  ON "customer_consents" ("customer_id", "channel", "purpose")
  WHERE "withdrawn_at" IS NULL;

ALTER TABLE "asset_categories"
  ADD CONSTRAINT "asset_categories_code_format" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{1,29}$');

ALTER TABLE "assets"
  ADD CONSTRAINT "assets_attributes_object" CHECK (jsonb_typeof("attributes") = 'object'),
  ADD CONSTRAINT "assets_warranty_range" CHECK ("warranty_start" IS NULL OR "warranty_end" IS NULL OR "warranty_end" >= "warranty_start"),
  ADD CONSTRAINT "assets_version_positive" CHECK ("version" >= 1);

ALTER TABLE "files"
  ADD CONSTRAINT "files_size_positive" CHECK ("size_bytes" > 0),
  ADD CONSTRAINT "files_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "files_single_uploader" CHECK ("uploaded_by_user_id" IS NULL OR "uploaded_by_customer_id" IS NULL);

ALTER TABLE "service_jobs"
  ADD CONSTRAINT "service_jobs_checklist_array" CHECK (jsonb_typeof("intake_checklist") = 'array'),
  ADD CONSTRAINT "service_jobs_complaint_not_blank" CHECK (btrim("complaint") <> ''),
  ADD CONSTRAINT "service_jobs_on_site_address" CHECK ("service_mode" <> 'ON_SITE' OR "service_address" IS NOT NULL),
  ADD CONSTRAINT "service_jobs_received" CHECK ("status" = 'AWAITING_DEVICE' OR "received_at" IS NOT NULL),
  ADD CONSTRAINT "service_jobs_creator" CHECK (("created_by_id" IS NULL) <> ("created_by_customer_id" IS NULL)),
  ADD CONSTRAINT "service_jobs_version_positive" CHECK ("version" >= 1);

ALTER TABLE "job_attachments"
  ADD CONSTRAINT "job_attachments_category" CHECK ("category" IN ('INTAKE_PHOTO', 'WARRANTY_PROOF', 'CUSTOMER_PHOTO', 'OTHER'));

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_layout" CHECK ("layout" IN ('A4', 'THERMAL_80')),
  ADD CONSTRAINT "documents_version_positive" CHECK ("version" >= 1);

ALTER TABLE "customer_otp_challenges"
  ADD CONSTRAINT "customer_otp_challenges_attempts" CHECK ("attempts" >= 0),
  ADD CONSTRAINT "customer_otp_challenges_hash_format" CHECK ("code_hash" ~ '^[0-9a-f]{64}$');

-- Job status history is append-only (CLAUDE.md §4.3).
CREATE FUNCTION "job_status_history_prevent_modification"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'job_status_history is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "job_status_history_no_update_or_delete"
  BEFORE UPDATE OR DELETE ON "job_status_history"
  FOR EACH ROW EXECUTE FUNCTION "job_status_history_prevent_modification"();

-- Issued documents are immutable records.
CREATE FUNCTION "documents_prevent_modification"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'documents are immutable: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "documents_no_update_or_delete"
  BEFORE UPDATE OR DELETE ON "documents"
  FOR EACH ROW EXECUTE FUNCTION "documents_prevent_modification"();
