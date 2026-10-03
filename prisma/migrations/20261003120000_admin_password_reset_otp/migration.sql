-- "Parolni unutdim": email orqali bir martalik kod (OTP) va majburiy parol almashtirish.
-- panel_users.email allaqachon majburiy va unique — o'zgarmaydi. Mavjud adminlar uchun
-- must_change_password = false (odatdagidek ishlashda davom etadi). Ma'lumot o'chirilmaydi.
--
-- Orqaga qaytarish (Prisma down migratsiyani qo'llamaydi — kerak bo'lsa qo'lda):
--   DROP TABLE "admin_otps";
--   ALTER TABLE "panel_users" DROP COLUMN "must_change_password";

ALTER TABLE "panel_users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "admin_otps" (
    "id" SERIAL NOT NULL,
    "admin_id" INTEGER NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_otps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_otps_admin_id_created_at_idx" ON "admin_otps"("admin_id", "created_at");

ALTER TABLE "admin_otps" ADD CONSTRAINT "admin_otps_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "panel_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
