-- AlterTable
ALTER TABLE "notification_outbox" ADD COLUMN     "branch_id" UUID;

-- CreateIndex
CREATE INDEX "notification_outbox_organization_id_branch_id_idx" ON "notification_outbox"("organization_id", "branch_id");
