-- "Mening xaridlarim" bo'limi olib tashlandi: Telegram "Menu" ro'yxatidan /purchases buyrug'i va
-- bazadagi buyruq javoblaridan unga ishora qiluvchi qatorlar o'chiriladi (faqat ma'lumot, sxema o'zgarmaydi).
-- Buyurtmalar, to'lovlar va kirish huquqlariga (orders, receipts, access_grants) tegilmaydi.
DELETE FROM "bot_menu" WHERE "command" = 'purchases';

UPDATE "bot_commands"
SET "response" = regexp_replace("response", E'\\n?[^\\n]*/purchases[^\\n]*', '', 'g'),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "response" LIKE '%/purchases%';
