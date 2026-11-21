-- CreateEnum
CREATE TYPE "invoice_document_type" AS ENUM ('TAX_INVOICE', 'BILL_OF_SUPPLY');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "document_type" "invoice_document_type" NOT NULL DEFAULT 'TAX_INVOICE',
ADD COLUMN     "document_type_reason" VARCHAR(500);

-- ADR 0024: Bill of Supply carries no GST and needs a recorded reason.
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_bill_of_supply_no_tax" CHECK (
    "document_type" = 'TAX_INVOICE'
    OR ("cgst_total" = 0 AND "sgst_total" = 0 AND "igst_total" = 0 AND "document_type_reason" IS NOT NULL)
  );

-- ADR 0024 (owner Q26): zero-value invoices for warranty / no-charge jobs may be issued.
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_issue_consistent";
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issue_consistent" CHECK (
  ("status" = 'DRAFT' AND "invoice_number" IS NULL AND "issued_at" IS NULL AND "credited_total" = 0 AND "allocated_total" = 0)
  OR ("status" <> 'DRAFT' AND "invoice_number" IS NOT NULL AND "financial_year" IS NOT NULL AND "invoice_date" IS NOT NULL
      AND "issued_at" IS NOT NULL AND "issued_by_id" IS NOT NULL AND "supplier" IS NOT NULL AND "total" >= 0)
);

-- A zero-value invoice is cancelled with a full, zero-value credit note; every other credit note is positive.
ALTER TABLE "credit_notes" DROP CONSTRAINT "credit_notes_totals";
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_totals" CHECK (
  ("total" > 0 OR ("total" = 0 AND "is_full"))
  AND "total" = "taxable_total" + "cgst_total" + "sgst_total" + "igst_total" + "round_off"
);

-- Issued invoices: the document type and its reason are frozen too.
CREATE OR REPLACE FUNCTION "invoices_guard_issued"() RETURNS trigger
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
        NEW."round_off", NEW."total", NEW."notes", NEW."terms", NEW."issued_at", NEW."issued_by_id", NEW."created_at",
        NEW."document_type", NEW."document_type_reason")
       IS DISTINCT FROM
       (OLD."organization_id", OLD."branch_id", OLD."job_id", OLD."customer_id", OLD."invoice_number", OLD."financial_year",
        OLD."invoice_date", OLD."currency", OLD."supply_type", OLD."place_of_supply_code", OLD."reverse_charge", OLD."supplier",
        OLD."recipient", OLD."taxable_total", OLD."cgst_total", OLD."sgst_total", OLD."igst_total", OLD."tax_total",
        OLD."round_off", OLD."total", OLD."notes", OLD."terms", OLD."issued_at", OLD."issued_by_id", OLD."created_at",
        OLD."document_type", OLD."document_type_reason") THEN
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
