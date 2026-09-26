-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "cancel_reason" TEXT,
ADD COLUMN     "cancelled_at" TIMESTAMPTZ,
ADD COLUMN     "cancelled_by_panel_user_id" INTEGER;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "deleted_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "error_logs" (
    "id" BIGSERIAL NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "error_type" TEXT,
    "error_text" TEXT,
    "stack" TEXT,
    "context" JSONB,
    "count" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "error_logs_fingerprint_key" ON "error_logs"("fingerprint");

-- CreateIndex
CREATE INDEX "error_logs_resolved_at_last_seen_at_idx" ON "error_logs"("resolved_at", "last_seen_at");

-- CreateIndex
CREATE INDEX "error_logs_last_seen_at_idx" ON "error_logs"("last_seen_at");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelled_by_panel_user_id_fkey" FOREIGN KEY ("cancelled_by_panel_user_id") REFERENCES "panel_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
