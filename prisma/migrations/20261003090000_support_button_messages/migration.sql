-- "Yordam" URL tugmali xabarlar: support username o'zgarganda eski xabarlardagi tugmalar yangilanadi.
-- Faqat yangi jadval qo'shiladi, mavjud jadvallarga tegilmaydi.
CREATE TABLE "support_button_messages" (
    "chat_id" BIGINT NOT NULL,
    "message_id" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "markup" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_button_messages_pkey" PRIMARY KEY ("chat_id","message_id")
);

CREATE INDEX "support_button_messages_url_idx" ON "support_button_messages"("url");
CREATE INDEX "support_button_messages_updated_at_idx" ON "support_button_messages"("updated_at");
