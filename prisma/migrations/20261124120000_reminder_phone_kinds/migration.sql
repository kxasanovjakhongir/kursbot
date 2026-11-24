-- Eslatmalar: telefon bermaganlar uchun 2 bosqich (video eslatmasi)
ALTER TYPE "ReminderKind" ADD VALUE IF NOT EXISTS 'phone_1';
ALTER TYPE "ReminderKind" ADD VALUE IF NOT EXISTS 'phone_2';
