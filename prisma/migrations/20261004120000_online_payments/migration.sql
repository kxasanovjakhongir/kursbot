-- Onlayn to'lovlar: Payme (Merchant API) va Click (Shop API) tranzaksiyalari

-- CreateTable
CREATE TABLE "payment_transactions" (
    "id" BIGSERIAL NOT NULL,
    "provider" "PaymentMethod" NOT NULL,
    "external_id" TEXT NOT NULL,
    "order_id" BIGINT NOT NULL,
    "amount" INTEGER NOT NULL,
    "state" INTEGER NOT NULL DEFAULT 1,
    "reason" INTEGER,
    "provider_time" BIGINT,
    "performed_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "meta" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_provider_external_id_key" ON "payment_transactions"("provider", "external_id");

-- CreateIndex
CREATE INDEX "payment_transactions_order_id_idx" ON "payment_transactions"("order_id");

-- CreateIndex
CREATE INDEX "payment_transactions_provider_provider_time_idx" ON "payment_transactions"("provider", "provider_time");

-- Bitta buyurtmaga bir vaqtda faqat bitta kutilayotgan va faqat bitta to'langan tranzaksiya (poyga holatlaridan himoya)
CREATE UNIQUE INDEX "payment_transactions_one_pending" ON "payment_transactions"("order_id") WHERE "state" = 1;
CREATE UNIQUE INDEX "payment_transactions_one_paid" ON "payment_transactions"("order_id") WHERE "state" = 2;

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
