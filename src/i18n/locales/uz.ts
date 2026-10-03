/**
 * O'zbekcha matnlar — asosiy til. Boshqa tillar shu kalitlarning barchasini berishi shart (TypeScript tekshiradi).
 * HTML formatida. {kalit} lar avtomatik to'ldiriladi va HTML-escape qilinadi.
 */
export const uz = {
  // ---------- Start va telefon ----------
  welcome:
    "Assalomu alaykum, {ism}! 👋\n\nDarsliklar botiga xush kelibsiz.\nKerakli bo'limni pastdagi menyudan tanlang 👇",
  welcome_back: "Qaytganingizdan xursandmiz, {ism}! 👋\n\nKerakli bo'limni pastdagi menyudan tanlang 👇",
  welcome_phone:
    "Assalomu alaykum, {ism}! 👋\n\n<b>{mahsulot}</b> haqida to'liq ma'lumot olish uchun pastdagi tugma orqali telefon raqamingizni yuboring.\n\n<i>🔒 Raqamingiz faqat xarid bo'yicha bog'lanish uchun ishlatiladi.</i>",
  link_welcome: "👋 {ism}, <b>{mahsulot}</b> darsligiga xush kelibsiz!\n\nQuyida darslik haqida batafsil ma'lumot. Barcha darsliklarni «📚 Darsliklar» bo'limida ko'rishingiz mumkin.",
  link_unavailable: "⚠️ Bu havola noto'g'ri yoki eskirgan. Barcha darsliklar bilan tanishib chiqing 👇",
  welcome_phone_generic:
    "Assalomu alaykum, {ism}! 👋\n\nDavom etish uchun pastdagi tugma orqali telefon raqamingizni yuboring.\n\n<i>🔒 Raqamingiz faqat xarid bo'yicha bog'lanish uchun ishlatiladi.</i>",
  phone_button: "📱 Raqamni yuborish",
  phone_own_only: "Iltimos, pastdagi tugma orqali <b>o'z</b> raqamingizni yuboring 👇",
  phone_saved: "✅ Rahmat! Raqamingiz saqlandi.",
  phone_update_prompt: "📱 Yangi raqamni yuborish uchun pastdagi tugmani bosing.",
  phone_updated: "✅ Telefon raqamingiz yangilandi.",

  // ---------- Menyu va navigatsiya ----------
  menu_products: "📚 Darsliklar",
  menu_profile: "👤 Profil",
  menu_help: "💬 Yordam",
  menu_settings: "⚙️ Sozlamalar",
  menu_admin: "🛠 Admin panel",
  home_title: "🏠 <b>Bosh menyu</b>\n\nKerakli bo'limni tanlang:",
  btn_back: "⬅️ Orqaga",
  btn_home: "🏠 Bosh menyu",
  btn_cancel: "❌ Bekor qilish",
  action_cancelled: "Bekor qilindi.",
  loading: "⏳ Ma'lumotlar yuklanmoqda...",

  // ---------- Darsliklar ----------
  choose_product: "📚 <b>Darsliklar</b>\n\nQaysi darslik sizni qiziqtiradi? 👇",
  no_products: "📚 <b>Darsliklar</b>\n\nHozircha sotuvda darsliklar yo'q. Tez orada qo'shiladi!",
  product_caption: "<b>{mahsulot}</b>\n{tavsif}\n\n💰 Narxi: {narx_qator}",
  btn_course_about: "📚 Kurs haqida",
  btn_course_price: "💰 Narxi",
  btn_course_program: "🎓 Dastur",
  btn_course_teacher: "👨‍🏫 O'qituvchi",
  course_about_title: "📚 <b>{mahsulot}</b>",
  course_fact_duration: "⏱ Davomiyligi: {v}",
  course_fact_lessons: "🎬 Darslar soni: {v}",
  course_fact_start: "📅 Boshlanishi: {v}",
  course_fact_audience: "👥 Kimlar uchun:\n{v}",
  course_fact_benefits: "✨ Afzalliklari:\n{v}",
  course_price: "💰 <b>{mahsulot}</b> — narxi\n\n{narx_qator}\n\nTo'lov kartaga o'tkazma orqali, chek admin tomonidan tekshiriladi.",
  course_program: "🎓 <b>{mahsulot}</b> — dastur\n\n{v}",
  course_teacher: "👨‍🏫 <b>{mahsulot}</b> — o'qituvchi\n\n{v}",
  btn_buy: "✅ Darslikni olaman",
  already_owned: "✅ Siz bu darslikni olgansiz.\n\nKanal linkini kurs sahifasidagi «🔗 Kanal havolasi» tugmasi orqali qayta olishingiz mumkin.",
  bundle_partial: "Sizda to'plamdagi darsliklardan biri allaqachon bor. Yetishmayotgan darslik:",

  // ---------- To'lov ----------
  payment_info:
    "🧾 <b>Buyurtma #{raqam}</b>\n\n📚 Darslik: {mahsulot}\n💰 Summa: <b>{summa}</b>\n💳 Karta: <code>{karta}</code>\n👤 Egasi: {karta_egasi}",
  payment_step_1: "1️⃣ Kartaga aynan shu summani o'tkazing.",
  payment_step_2: "2️⃣ To'lov chekini (skrinshot yoki PDF) <b>shu chatga yuboring</b>.",
  payment_expires: "⏳ Buyurtma {expires_at} gacha amal qiladi.",
  payment_info_shortfall: "\n\n⚠️ Oldingi to'lovda <b>{farq}</b> kam edi. Qolgan summani o'tkazib, chekni yuboring.",
  payment_under_review: "🔎 Buyurtma #{raqam} bo'yicha chekingiz tekshirilmoqda. Tez orada javob beramiz.",
  payment_unavailable: "😔 Kechirasiz, to'lov ma'lumotlari hozircha tayyor emas. Admin tez orada siz bilan bog'lanadi.",
  btn_copy_card: "📋 Karta raqamini nusxalash",
  order_cancel_confirm:
    "❓ <b>Buyurtma #{raqam} bekor qilinsinmi?</b>\n\n{mahsulot}\n\nKeyin istalgan vaqtda qaytadan buyurtma berishingiz mumkin.",
  btn_cancel_yes: "✅ Ha, bekor qilish",
  btn_cancel_no: "⬅️ Yo'q, qaytish",
  order_cancelled: "✅ Buyurtma #{raqam} bekor qilindi.",
  order_cancel_failed: "Bu buyurtmani bekor qilib bo'lmaydi: chek allaqachon yuborilgan yoki buyurtma yopilgan.",
  order_cancelled_by_admin: "❌ <b>Buyurtma #{raqam}</b> ({mahsulot}) admin tomonidan bekor qilindi.{sabab}\n\nSavollar bo'lsa, admin bilan bog'laning.",
  order_refunded_by_admin: "❌ <b>Buyurtma #{raqam}</b> ({mahsulot}) admin tomonidan bekor qilindi, kanalga kirish yopildi.{sabab}\n\nSavollar bo'lsa, admin bilan bog'laning.",
  order_cancel_reason: "\n\n📝 Sabab: {sabab}",

  // ---------- Chek ----------
  receipt_received: "✅ Rahmat! Chekingiz qabul qilindi.\n\nAdmin 15 daqiqa ichida tekshiradi va sizga kanal linkini yuboramiz.",
  receipt_received_offhours:
    "✅ Rahmat! Chekingiz qabul qilindi.\n\n🌙 Hozir ish vaqtidan tashqari — chekingiz ertaga soat {ish_boshi} dan keyin tekshiriladi.",
  receipt_invalid: "📎 Iltimos, to'lov chekining rasmini yoki PDF faylini yuboring.",
  receipt_too_big: "Fayl hajmi {mb} MB dan oshmasligi kerak. Iltimos, chek rasmini yuboring.",
  receipt_under_review: "🔎 Chekingiz allaqachon tekshirilmoqda. Iltimos, biroz kuting.",
  receipt_max_attempts: "Bu buyurtma uchun chek yuborish urinishlari tugadi. Iltimos, admin bilan bog'laning.",
  receipt_which_product: "Bu chek qaysi darslik uchun?",
  receipt_which_order: "Bu chek qaysi buyurtma uchun?",
  receipt_order_closed: "Bu buyurtma yopilgan. Darslikni qaytadan tanlab, yangi buyurtma oching.",
  resend_hint: "📎 Chek rasmini yoki PDF faylini shu yerga yuboring.",

  // ---------- Tasdiqlash / rad etish ----------
  approved: "🎉 <b>To'lov muvaffaqiyatli amalga oshirildi!</b>\n\nEndi kurs darslaridan foydalanishingiz mumkin. Yopiq kanalga quyidagi tugma orqali qo'shiling — link faqat siz uchun va {kun} kun amal qiladi.",
  approved_no_link: "🎉 <b>To'lov muvaffaqiyatli amalga oshirildi!</b>\n\nEndi kurs darslaridan foydalanishingiz mumkin. Kanal linkini admin tez orada yuboradi.",
  btn_join: "➡️ Kanalga qo'shilish: {mahsulot}",
  btn_start_course: "📚 Kursni boshlash",
  rejected: "⚠️ <b>Afsuski, chekingiz tasdiqlanmadi.</b>\n\nSabab: {sabab}",
  btn_resend: "🔁 Chekni qayta yuborish",
  btn_contact_admin: "👤 Admin bilan bog'lanish",
  contact_admin_hint: "Admin bilan bog'lanish uchun: {kontakt}",
  support_not_configured: "ℹ️ Yordam xizmati hozircha sozlanmagan.",
  joined_welcome: "🎉 Xush kelibsiz! {mahsulot} kanaldagi birinchi postdan boshlanadi.",

  // ---------- Rad etish sabablari (mijozga) ----------
  reject_unreadable: "Chek rasmi aniq emas, iltimos, to'liq skrinshot yuboring",
  reject_short: "To'lov summasi {farq} kam. Qolgan summani o'tkazib, chekni yuboring",
  reject_wrong_card: "To'lov boshqa kartaga o'tkazilgan. Ko'rsatilgan kartani tekshiring",
  reject_not_found: "Bu to'lov kartaga kelib tushmagan",
  reject_fake: "Chek tasdiqlanmadi. Savollar bo'lsa, admin bilan bog'laning",
  reject_other: "{matn}",

  // ---------- Kanalga kirish ----------
  access_expiring: "⏰ <b>{mahsulot}</b> — kanalga kirish muddati <b>{sana}</b> da tugaydi. Shundan keyin kanaldan avtomatik chiqarilasiz.",
  access_expired: "⌛️ <b>{mahsulot}</b> — kanalga kirish muddati tugadi va siz kanaldan chiqarildingiz.\n\nQayta olish uchun «📚 Darsliklar» bo'limiga o'ting.",
  access_removed: "🚫 Siz <b>{mahsulot}</b> kanalidan chiqarildingiz. Savollar bo'lsa, admin bilan bog'laning.",
  access_extended: "✅ <b>{mahsulot}</b> — kanalga kirish <b>{sana}</b> gacha uzaytirildi.",
  access_unlimited: "✅ <b>{mahsulot}</b> — kanalga kirish endi muddatsiz.",
  access_restored: "✅ <b>{mahsulot}</b> — kanalga kirish tiklandi. Linkni «📚 Darsliklar» → kurs → «🔗 Kanal havolasi» orqali oling.",
  link_refreshed: "🔗 Yangi link tayyor. Link faqat siz uchun.",
  link_loading: "⏳ Link tayyorlanmoqda...",
  link_failed: "Linkni olib bo'lmadi. Iltimos, admin bilan bog'laning.",

  // ---------- Profil ----------
  profile:
    "👤 <b>Profil</b>\n\n🪪 Ism: {ism}\n🔹 Username: {username}\n🆔 Telegram ID: <code>{id}</code>\n📱 Telefon: {telefon}\n🌐 Til: {til}\n📅 Ro'yxatdan o'tgan: {sana}\n\n📊 <b>Statistika</b>\n📚 Darsliklar: {darsliklar}\n🧾 Buyurtmalar: {buyurtmalar}\n💰 Jami to'lov: {jami}",
  btn_change_phone: "📱 Raqamni yangilash",
  btn_notifications: "🔔 Bildirishnomalar",
  not_set: "—",

  // ---------- Bildirishnomalar ----------
  notifications_title: "🔔 <b>Bildirishnomalar</b>",
  notifications_empty: "🔔 <b>Bildirishnomalar</b>\n\nHozircha bildirishnomalar yo'q.",
  admin_message: "💬 <b>Admin xabari</b>\n\n{matn}",

  // ---------- Sozlamalar ----------
  settings:
    "⚙️ <b>Sozlamalar</b>\n\n🌐 Til: {til}\n📢 Yangiliklar: {yangiliklar}\n\n<i>Buyurtma bo'yicha xabarlar har doim yuboriladi.</i>",
  btn_language: "🌐 Tilni o'zgartirish",
  btn_news_toggle_off: "🔕 Yangiliklarni o'chirish",
  btn_news_toggle_on: "🔔 Yangiliklarni yoqish",
  news_on: "yoqilgan ✅",
  news_off: "o'chirilgan",
  language_title: "🌐 <b>Tilni tanlang</b>",
  language_changed: "✅ Til o'zgartirildi.",

  // ---------- Kurs darslari ----------
  course_owned: "✅ <b>{mahsulot}</b>\n\nSiz bu kursni olgansiz.",
  course_lessons_hint: "🎬 Darslar: {soni} ta. Ko'rish uchun darsni tanlang 👇",
  course_no_lessons: "🎬 Darslar hali qo'shilmagan. Qo'shilishi bilan shu yerda paydo bo'ladi.",
  course_bundle_owned: "✅ <b>{mahsulot}</b>\n\nTo'plamdagi kursni tanlang 👇",
  lessons_title: "🎬 <b>{mahsulot}</b> — darslar ({soni} ta)\n\n🔒 Darslarni ko'rish uchun kursni xarid qiling.",
  intro_video_title: "🎥 <b>{mahsulot}</b> — tanishtiruv videosi",
  intro_video_text: "Videoni ko'rib chiqing, kurs haqida batafsil ma'lumot va narx pastda 👇",
  btn_lessons: "🎬 Darslar ({soni})",
  btn_channel_link: "🔗 Kanal havolasi",
  lesson_locked: "🔒 Bu darslikdan foydalanish uchun avval kursni xarid qilishingiz kerak.",
  lesson_sending: "⏳ Video yuborilmoqda...",
  lesson_unavailable: "⚠️ Bu video hozircha mavjud emas. Admin xabardor qilindi — tez orada tuzatiladi.",

  // ---------- Yordam ----------
  help:
    "💬 <b>Yordam</b>\n\n<b>Darslikni qanday olaman?</b>\n1️⃣ «📚 Darsliklar» bo'limidan darslikni tanlang.\n2️⃣ «✅ Darslikni olaman» tugmasini bosing.\n3️⃣ Kartaga to'lov qiling va chekni shu chatga yuboring.\n4️⃣ Admin tasdiqlagach, yopiq kanal linkini olasiz.\n\n<b>Link eskirdimi?</b>\n«📚 Darsliklar» → kursni tanlang → «🔗 Kanal havolasi».\n\nSavol bo'lsa, admin bilan bog'laning 👇",

  // ---------- Xatolar ----------
  error_generic: "❌ Xatolik yuz berdi.\n\nIltimos, birozdan keyin qayta urinib ko'ring.",
  error_database: "❌ Ma'lumotlarni yuklashda xatolik.\n\nIltimos, birozdan keyin qayta urinib ko'ring.",
  error_unknown_command: "🤔 Bunday buyruq topilmadi.\n\nPastdagi menyudan foydalaning yoki /help ni bosing.",
  error_not_found: "🔍 Ma'lumot topilmadi. U o'chirilgan yoki eskirgan bo'lishi mumkin.",
  error_stale_button: "Bu tugma eskirgan. Menyudan qayta tanlang.",
  error_too_many: "⏳ Juda ko'p so'rov. Iltimos, bir necha soniya kuting.",
  error_banned: "⛔️ Botdan foydalanishingiz cheklangan.\n\nSavollar bo'lsa, admin bilan bog'laning.",
  maintenance: "🛠 Tizim vaqtincha texnik xizmatda.\n\nIltimos, keyinroq urinib ko'ring.",

  // ---------- Rollar ----------
  role_user: "Foydalanuvchi",
  role_admin: "Admin",
  role_superadmin: "Super admin",

  // ---------- Admin panel (botda) ----------
  adm_title: "🛠 <b>Admin panel</b>\n\nRolingiz: {rol}\nKutilayotgan cheklar: <b>{cheklar}</b>\n\nKerakli bo'limni tanlang:",
  adm_btn_stats: "📊 Statistika",
  adm_btn_pending: "🧾 Cheklar ({soni})",
  adm_btn_products: "📦 Mahsulotlar",
  adm_btn_cards: "💳 Kartalar",
  adm_btn_admins: "👮 Adminlar",
  adm_btn_commands: "📖 Buyruqlar",
  adm_btn_refresh: "🔄 Yangilash",
  adm_stats:
    "📊 <b>Statistika</b>\n\n👥 <b>Foydalanuvchilar</b>\nJami: {jami}\nBugun yangi: {bugun}\n7 kunda yangi: {hafta}\nFaol (30 kun): {faol}\nBotni bloklagan: {bloklagan}\n\n🛒 <b>Savdo</b>\nBugungi buyurtmalar: {buyurtmalar}\nKutilayotgan cheklar: {cheklar}\nBugungi tushum: {tushum_bugun}\n30 kunlik tushum: {tushum_oy}\n\n🕒 {vaqt}",
  adm_no_permission: "⛔️ Bu bo'lim uchun ruxsatingiz yo'q.",
};

export type Messages = typeof uz;
export type TextKey = keyof Messages;
