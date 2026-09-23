-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('text', 'photo', 'video', 'document', 'other');

-- CreateEnum
CREATE TYPE "BroadcastAudience" AS ENUM ('all', 'active', 'specific');

-- CreateEnum
CREATE TYPE "BroadcastStatus" AS ENUM ('pending', 'sending', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('pending', 'sent', 'failed', 'skipped');

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "message_type" "MessageType" NOT NULL DEFAULT 'text',
ADD COLUMN     "telegram_message_id" INTEGER;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_bot" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "language_code" TEXT;

-- CreateTable
CREATE TABLE "panel_users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'admin',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "panel_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcasts" (
    "id" SERIAL NOT NULL,
    "message_type" "MessageType" NOT NULL,
    "text" TEXT,
    "file_id" TEXT,
    "file_name" TEXT,
    "audience" "BroadcastAudience" NOT NULL,
    "status" "BroadcastStatus" NOT NULL DEFAULT 'pending',
    "total" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT NOT NULL,
    "created_by" INTEGER,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcast_recipients" (
    "id" BIGSERIAL NOT NULL,
    "broadcast_id" INTEGER NOT NULL,
    "user_id" BIGINT NOT NULL,
    "status" "RecipientStatus" NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "telegram_message_id" INTEGER,
    "sent_at" TIMESTAMPTZ,

    CONSTRAINT "broadcast_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_commands" (
    "id" SERIAL NOT NULL,
    "command" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "response" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bot_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_menu" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bot_menu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" BIGSERIAL NOT NULL,
    "panel_user_id" INTEGER,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ip_address" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "panel_users_email_key" ON "panel_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "broadcasts_idempotency_key_key" ON "broadcasts"("idempotency_key");

-- CreateIndex
CREATE INDEX "broadcasts_created_at_idx" ON "broadcasts"("created_at");

-- CreateIndex
CREATE INDEX "broadcast_recipients_broadcast_id_status_idx" ON "broadcast_recipients"("broadcast_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_recipients_broadcast_id_user_id_key" ON "broadcast_recipients"("broadcast_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "bot_commands_command_key" ON "bot_commands"("command");

-- CreateIndex
CREATE UNIQUE INDEX "bot_menu_command_key" ON "bot_menu"("command");

-- CreateIndex
CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs"("created_at");

-- CreateIndex
CREATE INDEX "activity_logs_panel_user_id_idx" ON "activity_logs"("panel_user_id");

-- CreateIndex
CREATE INDEX "messages_user_id_created_at_idx" ON "messages"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_created_at_idx" ON "messages"("created_at");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- CreateIndex
CREATE INDEX "users_last_seen_at_idx" ON "users"("last_seen_at");

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "panel_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_panel_user_id_fkey" FOREIGN KEY ("panel_user_id") REFERENCES "panel_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
