-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('channel', 'bundle');

-- CreateEnum
CREATE TYPE "FilesMode" AS ENUM ('auto', 'semi', 'manual');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('new', 'receipt_sent', 'rejected', 'approved', 'joined', 'expired', 'cancelled', 'refunded');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('card', 'payme', 'click');

-- CreateEnum
CREATE TYPE "ReceiptFileType" AS ENUM ('photo', 'pdf', 'image');

-- CreateEnum
CREATE TYPE "ReminderKind" AS ENUM ('pay_1', 'pay_2', 'pay_3', 'video', 'upsell', 'join');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('admin', 'superadmin');

-- CreateEnum
CREATE TYPE "PromoKind" AS ENUM ('amount', 'percent');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('incoming', 'outgoing');

-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "username" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "phone" TEXT,
    "is_foreign" BOOLEAN NOT NULL DEFAULT false,
    "first_source" TEXT,
    "first_product" TEXT,
    "last_product" TEXT,
    "last_source" TEXT,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "referrer_id" BIGINT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "price" INTEGER NOT NULL DEFAULT 0,
    "old_price" INTEGER,
    "video_file_id" TEXT,
    "type" "ProductType" NOT NULL DEFAULT 'channel',
    "channel_id" BIGINT,
    "bundle_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "files_mode" "FilesMode" NOT NULL DEFAULT 'auto',
    "file_message_ids" BIGINT[] DEFAULT ARRAY[]::BIGINT[],
    "access_days" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "product_id" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "promo_id" INTEGER,
    "card_id" INTEGER,
    "status" "OrderStatus" NOT NULL DEFAULT 'new',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "shortfall" INTEGER,
    "reviewed_by" INTEGER,
    "reviewed_at" TIMESTAMPTZ,
    "reject_reason" TEXT,
    "admin_note" TEXT,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "paid_at" TIMESTAMPTZ,
    "source" TEXT,
    "payment_method" "PaymentMethod" NOT NULL DEFAULT 'card',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" BIGSERIAL NOT NULL,
    "order_id" BIGINT NOT NULL,
    "file_id" TEXT NOT NULL,
    "file_unique_id" TEXT NOT NULL,
    "file_type" "ReceiptFileType" NOT NULL,
    "is_duplicate" BOOLEAN NOT NULL DEFAULT false,
    "admin_chat_id" BIGINT,
    "admin_message_id" BIGINT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_grants" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "product_id" INTEGER NOT NULL,
    "order_id" BIGINT NOT NULL,
    "invite_link" TEXT,
    "link_expires_at" TIMESTAMPTZ,
    "joined_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "files_sent_at" TIMESTAMPTZ,
    "files_sent_by" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "order_id" BIGINT,
    "kind" "ReminderKind" NOT NULL,
    "send_at" TIMESTAMPTZ NOT NULL,
    "sent_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cards" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "number_masked" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "bank" TEXT,
    "monthly_limit" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "last_used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "PromoKind" NOT NULL,
    "value" INTEGER NOT NULL,
    "product_id" INTEGER,
    "max_uses" INTEGER,
    "used" INTEGER NOT NULL DEFAULT 0,
    "valid_until" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" SERIAL NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "name" TEXT,
    "role" "AdminRole" NOT NULL DEFAULT 'admin',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "texts" (
    "key" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'uz',
    "body" TEXT NOT NULL,

    CONSTRAINT "texts_pkey" PRIMARY KEY ("key","lang")
);

-- CreateTable
CREATE TABLE "events" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT,
    "name" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "text" TEXT,
    "admin_id" INTEGER,
    "admin_message_id" BIGINT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "admin_id" INTEGER,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_id_key" ON "users"("telegram_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");

-- CreateIndex
CREATE INDEX "orders_user_id_product_id_status_idx" ON "orders"("user_id", "product_id", "status");

-- CreateIndex
CREATE INDEX "orders_status_expires_at_idx" ON "orders"("status", "expires_at");

-- CreateIndex
CREATE INDEX "receipts_file_unique_id_idx" ON "receipts"("file_unique_id");

-- CreateIndex
CREATE INDEX "receipts_order_id_idx" ON "receipts"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "access_grants_invite_link_key" ON "access_grants"("invite_link");

-- CreateIndex
CREATE INDEX "access_grants_user_id_product_id_idx" ON "access_grants"("user_id", "product_id");

-- CreateIndex
CREATE INDEX "reminders_user_id_sent_at_cancelled_at_idx" ON "reminders"("user_id", "sent_at", "cancelled_at");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "admins_telegram_id_key" ON "admins"("telegram_id");

-- CreateIndex
CREATE INDEX "events_name_created_at_idx" ON "events"("name", "created_at");

-- CreateIndex
CREATE INDEX "events_user_id_name_idx" ON "events"("user_id", "name");

-- CreateIndex
CREATE INDEX "messages_admin_message_id_idx" ON "messages"("admin_message_id");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_idx" ON "audit_log"("entity", "entity_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "promo_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_files_sent_by_fkey" FOREIGN KEY ("files_sent_by") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- BR-01: bitta foydalanuvchida bitta mahsulotga faqat bitta ochiq buyurtma
CREATE UNIQUE INDEX "orders_one_open" ON "orders"("user_id", "product_id")
  WHERE "status" IN ('new', 'receipt_sent', 'rejected');
