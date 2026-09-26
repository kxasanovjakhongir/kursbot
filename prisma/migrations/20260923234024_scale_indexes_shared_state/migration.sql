-- CreateTable
CREATE TABLE "job_locks" (
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "job_locks_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "bot_state" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bot_state_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "bot_state_expires_at_idx" ON "bot_state"("expires_at");

-- CreateIndex
CREATE INDEX "access_grants_product_id_idx" ON "access_grants"("product_id");

-- CreateIndex
CREATE INDEX "events_created_at_idx" ON "events"("created_at");

-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");

-- Muddat vazifasi: faqat faol va muddatli kirishlar (jadvalning kichik qismi) indekslanadi
CREATE INDEX "access_grants_active_expiry_idx" ON "access_grants"("expires_at")
  WHERE "revoked_at" IS NULL AND "expires_at" IS NOT NULL;
