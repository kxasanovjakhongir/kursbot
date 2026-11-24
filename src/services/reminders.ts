import { InlineKeyboard, type Api } from "grammy";
import type { Prisma, Product, ReminderKind, User } from "@prisma/client";
import { prisma } from "../db";
import { joinParts, label, translate, type Lang, type TextKey } from "../i18n";
import { logger } from "../lib/logger";
import { formatShortDateTime, tashkentMinuteOfDay } from "../lib/format";
import { phoneKeyboard } from "../bot/keyboards";
import { sendToUser } from "../bot/notify";
import { CB } from "../bot/ui/callbacks";
import { checkOwnership, getActiveProduct } from "./products";
import { withLease } from "./leases";
import { displayCourseName, getSupportPhone, getSupportUrl } from "./settings";
import { userLang } from "./users";

const HOUR = 3600_000;

/**
 * Avtomatik eslatmalar (mijoz bir qadamda to'xtab qolsa):
 *   phone_1 / phone_2 — kursni tanlagan, telefon bermagan (videoni ko'rmagan): 1 soat jim tursa, keyin yana ~1 kundan so'ng;
 *   upsell            — videoni ko'rgan, lekin darslikni olmagan: 1 kundan so'ng (bir marta);
 *   pay_1 / 2 / 3     — buyurtma ochgan, to'lamagan: 1 soatdan, ~1 kundan so'ng va muddati tugashidan oldin.
 *
 * Har bir eslatma o'z kursi bo'yicha ({mahsulot}) va «savolingiz bo'lsa — admin» qatori bilan. Odam kerakli qadamni
 * bajarsa (raqam bersa, buyurtma ochsa, to'lasa) keyingilari yuborilmaydi — shart har safar yuborishdan oldin qayta
 * tekshiriladi. Bitta odamga 8 soatda bittadan ko'p eslatma yo'q, kechasi (22:00–09:00, Toshkent) yuborilmaydi.
 * Bosqichlar bir-birini istisno qiladi (raqam yo'q → telefon; raqam bor, buyurtma yo'q → «darslikni oling»; ochiq
 * buyurtma → to'lov), shuning uchun odam faqat o'zi turgan bosqichning eslatmasini oladi.
 * Faqat sotuv ochilgandan (22.11) keyin kelganlar. Birinchi eslatma kechikib borgan bo'lsa (eslatmalar yoqilishidan oldingi
 * odamlar) — keyingilari yuborilmaydi: bunday odam bitta eslatma oladi.
 * Paneldagi «Bot matnlari → Eslatmalar» da matn bo'shatilsa — o'sha eslatma o'chadi.
 */
export const REMINDER_RULES = {
  /** Botda shuncha vaqt jim tursa — birinchi eslatma */
  idleMs: 1 * HOUR,
  /** Oldingi eslatmadan keyin ikkinchisigacha */
  nextAfterMs: 23 * HOUR,
  /** Videoni ko'rgandan (oxirgi faollikdan) keyin «darslikni oling» eslatmasi */
  upsellAfterMs: 24 * HOUR,
  /** Buyurtma muddati tugashiga shuncha qolganda oxirgi to'lov eslatmasi */
  payLastBeforeExpiryMs: 12 * HOUR,
  /** Bitta odamga ikki eslatma orasidagi eng kam vaqt */
  minGapMs: 8 * HOUR,
  /**
   * Faqat sotuv ochilgandan (22.11.2026, Toshkent) keyin botga kelganlar — undan oldingilar o'zimizning odamlar
   */
  since: new Date("2026-11-21T19:00:00Z"),
  /** Shundan uzoq vaqt botga kirmaganlarga eslatma yuborilmaydi */
  maxIdleMs: 7 * 24 * HOUR,
  /**
   * Keyingi eslatmalar (phone_2, pay_2, pay_3) faqat birinchisi o'z vaqtida (bosqich boshlanganidan shu vaqt ichida)
   * borgan bo'lsa — eski odamlarga birinchi eslatma kechikib boradi va u yagona bo'ladi
   */
  followUpWithinMs: 18 * HOUR,
  /** Toshkent vaqti bilan [dan, gacha) soatlarda yuboriladi */
  fromHour: 9,
  toHour: 22,
  /** Bir ishga tushishda har bir turdan ko'pi bilan */
  batch: 25,
} as const;

/** Yuborish vaqtimi (kechasi odamni bezovta qilmaslik) */
export function isReminderHour(now: Date = new Date()): boolean {
  const hour = Math.floor(tashkentMinuteOfDay(now) / 60);
  return hour >= REMINDER_RULES.fromHour && hour < REMINDER_RULES.toHour;
}

type Recipient = Pick<User, "id" | "telegramId" | "firstName" | "username" | "language" | "lastProduct">;
const RECIPIENT = { id: true, telegramId: true, firstName: true, username: true, language: true, lastProduct: true } as const;

/** Eslatma oladigan odam: bot emas, bloklamagan, cheklanmagan, admin emas va yaqinda eslatma olmagan */
async function audience(now: Date, news = true): Promise<Prisma.UserWhereInput> {
  const admins = await prisma.admin.findMany({ select: { telegramId: true } });
  return {
    isBot: false,
    isBlocked: false,
    isBanned: false,
    createdAt: { gte: REMINDER_RULES.since },
    ...(news && { newsEnabled: true }),
    telegramId: { notIn: admins.map((a) => a.telegramId) },
    reminders: { none: { sentAt: { gt: new Date(now.getTime() - REMINDER_RULES.minGapMs) } } },
  };
}

interface Message {
  key: TextKey;
  /** Matnning o'zi «savolingiz bormi» deb so'raydi — oxiridagi sarlavha kerak emas */
  noSupportTitle?: boolean;
  vars: Record<string, string>;
  markup: (lang: Lang, support: string | null) => InlineKeyboard | ReturnType<typeof phoneKeyboard> | undefined;
}

function supportButton(kb: InlineKeyboard, lang: Lang, support: string | null): InlineKeyboard {
  return support ? kb.row().url(label(lang, "btn_contact_admin"), support) : kb;
}

/**
 * Bitta eslatma: matn (bo'sh — paneldan o'chirilgan → yuborilmaydi), oxirida admin lichkasi. Yozuv yuborishdan
 * oldin qo'yiladi — xato bo'lsa ham takror-takror urinilmaydi (odamga ikki marta bormaydi).
 */
async function deliver(api: Api, now: Date, seen: Set<bigint>, user: Recipient, kind: ReminderKind, orderId: bigint | null, msg: Message): Promise<boolean> {
  // Bir ishga tushishda bitta odamga bitta xabar (masalan, ikki kursga ochiq buyurtmasi bo'lsa ham)
  if (seen.has(user.id)) return false;
  seen.add(user.id);
  const lang = await userLang(user);
  const ism = user.firstName ?? user.username ?? "";
  const body = await translate(lang, msg.key, { ism, ...msg.vars });
  if (!body.trim()) return false;
  const support = await getSupportUrl();
  const text = joinParts([body, await contactFooter(lang, support, !msg.noSupportTitle)]);

  const row = await prisma.reminder.create({ data: { userId: user.id, orderId, kind, sendAt: now } });
  try {
    const sent = await sendToUser(api, user.telegramId, text, { reply_markup: msg.markup(lang, support) });
    await prisma.reminder.update({ where: { id: row.id }, data: sent ? { sentAt: now } : { cancelledAt: now } });
    return !!sent;
  } catch (err) {
    await prisma.reminder.update({ where: { id: row.id }, data: { cancelledAt: now } });
    logger.warn({ err, kind, userId: user.id.toString() }, "eslatma yuborilmadi");
    return false;
  }
}

/** Eslatma oxiri: «Savolingiz bo'lsa» + telefon (sozlamalardagi raqam) + Telegram profil */
async function contactFooter(lang: Lang, support: string | null, withTitle: boolean): Promise<string | null> {
  const phone = await getSupportPhone();
  const lines = joinParts(
    [
      phone ? await translate(lang, "reminder_support_phone", { telefon: phone }) : null,
      support ? await translate(lang, "reminder_support_telegram", { kontakt: `@${support.slice("https://t.me/".length)}` }) : null,
    ],
    "\n",
  );
  if (!lines) return null;
  return joinParts([withTitle ? await translate(lang, "reminder_support") : null, lines], "\n");
}

async function courseVars(product: Product | null): Promise<Record<string, string>> {
  return product ? { mahsulot: await displayCourseName(product.title) } : {};
}

// ---------- Telefon bermaganlar (videoni ko'rmagan) ----------

async function phoneReminders(api: Api, now: Date, run: Run): Promise<number> {
  const base = await audience(now);
  const idle = { lte: new Date(now.getTime() - REMINDER_RULES.idleMs), gte: new Date(now.getTime() - REMINDER_RULES.maxIdleMs) };
  const previous = new Date(now.getTime() - REMINDER_RULES.nextAfterMs);
  const stages: { kind: ReminderKind; where: Prisma.UserWhereInput }[] = [
    { kind: "phone_1", where: { lastSeenAt: idle, reminders: { none: { kind: { in: ["phone_1", "phone_2"] } } } } },
    {
      kind: "phone_2",
      where: {
        lastSeenAt: { lte: idle.lte },
        AND: [{ reminders: { some: { kind: "phone_1", sentAt: { lte: previous } } } }, { reminders: { none: { kind: "phone_2" } } }],
      },
    },
  ];
  let sent = 0;
  for (const stage of stages) {
    const users = await prisma.user.findMany({
      where: { AND: [base, stage.where, { phone: null }] },
      select: { ...RECIPIENT, lastSeenAt: true, reminders: { where: { kind: "phone_1" }, select: { sentAt: true } } },
      orderBy: { lastSeenAt: "desc" },
      take: run.batch,
    });
    for (const user of users) {
      const first = user.reminders[0]?.sentAt;
      if (stage.kind === "phone_2" && first && first.getTime() - user.lastSeenAt.getTime() > REMINDER_RULES.followUpWithinMs) {
        // 1-eslatma kechikib borgan (eski odam) — ikkinchisi yo'q; qayta tekshirilmasin
        await prisma.reminder.create({ data: { userId: user.id, kind: "phone_2", sendAt: now, cancelledAt: now } });
        continue;
      }
      const product = await getActiveProduct(user.lastProduct);
      const key: TextKey = product ? (stage.kind === "phone_1" ? "reminder_phone_1" : "reminder_phone_2") : "reminder_phone_generic";
      // Telefon tugmasi faqat pastki (reply) klaviaturada bo'ladi — admin lichkasi matnda
      if (await deliver(api, now, run.seen, user, stage.kind, null, { key, vars: await courseVars(product), markup: (lang) => phoneKeyboard(lang) })) sent++;
    }
  }
  return sent;
}

// ---------- Videoni ko'rgan, darslikni olmagan ----------

const OPEN_STATUSES = ["new", "receipt_sent"] as const;

async function upsellReminders(api: Api, now: Date, run: Run): Promise<number> {
  const users = await prisma.user.findMany({
    where: {
      AND: [
        await audience(now),
        {
          phone: { not: null },
          lastProduct: { not: null },
          lastSeenAt: { lte: new Date(now.getTime() - REMINDER_RULES.upsellAfterMs), gte: new Date(now.getTime() - REMINDER_RULES.maxIdleMs) },
          reminders: { none: { kind: "upsell" } },
          // Ochiq buyurtmasi borlarga — to'lov eslatmasi (pastda); sotib olganlarga — hech narsa
          orders: { none: { status: { in: [...OPEN_STATUSES, "approved", "joined"] } } },
        },
      ],
    },
    select: RECIPIENT,
    orderBy: { lastSeenAt: "desc" },
    take: run.batch,
  });
  let sent = 0;
  for (const user of users) {
    const product = await getActiveProduct(user.lastProduct);
    if (!product || (await checkOwnership(user.id, product)).kind !== "none") {
      // Kurs sotuvdan olingan yoki boshqa yo'l bilan olingan — qayta-qayta tekshirilmasin (navbatni to'sib qo'ymasin)
      await prisma.reminder.create({ data: { userId: user.id, kind: "upsell", sendAt: now, cancelledAt: now } });
      continue;
    }
    const ok = await deliver(api, now, run.seen, user, "upsell", null, {
      key: "reminder_upsell",
      noSupportTitle: true,
      vars: await courseVars(product),
      markup: (lang, support) =>
        supportButton(new InlineKeyboard().text(label(lang, "btn_reminder_video"), CB.product(product.code)), lang, support),
    });
    if (ok) sent++;
  }
  return sent;
}

// ---------- Buyurtma ochgan, to'lamagan ----------

/** Buyurtma uchun navbatdagi to'lov eslatmasi (yoki hech biri) */
export function nextPayReminder(
  order: { createdAt: Date; expiresAt: Date },
  sent: Partial<Record<"pay_1" | "pay_2" | "pay_3", Date>>,
  now: Date,
): "pay_1" | "pay_2" | "pay_3" | null {
  const left = order.expiresAt.getTime() - now.getTime();
  if (left < 30 * 60_000 || sent.pay_3) return null;
  // 1-eslatma kechikib borgan (eslatmalar yoqilishidan oldingi buyurtma) — boshqasi yo'q
  if (sent.pay_1 && sent.pay_1.getTime() - order.createdAt.getTime() > REMINDER_RULES.followUpWithinMs) return null;
  if (left <= REMINDER_RULES.payLastBeforeExpiryMs) {
    // Oxirgi eslatma: oldingisidan keyin kamida minGap o'tgan bo'lsin (yoki umuman bo'lmagan)
    const last = Math.max(sent.pay_1?.getTime() ?? 0, sent.pay_2?.getTime() ?? 0);
    return now.getTime() - last >= REMINDER_RULES.minGapMs ? "pay_3" : null;
  }
  if (!sent.pay_1) return now.getTime() - order.createdAt.getTime() >= REMINDER_RULES.idleMs ? "pay_1" : null;
  if (!sent.pay_2) return now.getTime() - sent.pay_1.getTime() >= REMINDER_RULES.nextAfterMs ? "pay_2" : null;
  return null;
}

const PAY_TEXT = { pay_1: "reminder_pay_1", pay_2: "reminder_pay_2", pay_3: "reminder_pay_3" } as const;

async function payReminders(api: Api, now: Date, run: Run): Promise<number> {
  const orders = await prisma.order.findMany({
    where: {
      status: "new",
      expiresAt: { gt: new Date(now.getTime() + 30 * 60_000) },
      createdAt: { lte: new Date(now.getTime() - REMINDER_RULES.idleMs) },
      product: { isActive: true, deletedAt: null },
      // Payme/Click to'lovi jarayonda — eslatma kerak emas
      transactions: { none: { state: 1 } },
      reminders: { none: { kind: "pay_3" } },
      user: await audience(now, false),
      // Yaqinda botga kirgan yoki eslatmalar zanjiri allaqachon boshlangan
      OR: [{ user: { lastSeenAt: { gte: new Date(now.getTime() - REMINDER_RULES.maxIdleMs) } } }, { reminders: { some: { kind: "pay_1" } } }],
    },
    include: { product: true, user: { select: RECIPIENT }, reminders: { select: { kind: true, sentAt: true, cancelledAt: true, sendAt: true } } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  let sent = 0;
  for (const order of orders) {
    if (sent >= run.batch) break;
    const done: Partial<Record<"pay_1" | "pay_2" | "pay_3", Date>> = {};
    for (const r of order.reminders) if (r.kind === "pay_1" || r.kind === "pay_2" || r.kind === "pay_3") done[r.kind] = r.sentAt ?? r.sendAt;
    const kind = nextPayReminder(order, done, now);
    if (!kind) continue;
    const ok = await deliver(api, now, run.seen, order.user, kind, order.id, {
      key: PAY_TEXT[kind],
      vars: { ...(await courseVars(order.product)), vaqt: formatShortDateTime(order.expiresAt) },
      markup: (lang, support) => supportButton(new InlineKeyboard().text(label(lang, "btn_reminder_pay"), CB.pay(order.id)), lang, support),
    });
    if (ok) sent++;
  }
  return sent;
}

/** Bitta ishga tushish: bir odamga bitta xabar (seen) va har bir turdan ko'pi bilan batch ta */
interface Run {
  seen: Set<bigint>;
  batch: number;
}

/** Fon vazifasi (jobs.ts): kunduzi har necha daqiqada navbatdagi eslatmalarni yuboradi */
export async function processReminders(
  api: Api,
  now: Date = new Date(),
  opts: { anyHour?: boolean; batch?: number } = {},
): Promise<{ pay: number; phone: number; upsell: number }> {
  if (!opts.anyHour && !isReminderHour(now)) return { pay: 0, phone: 0, upsell: 0 };
  // Avval to'lov (eng muhim), keyin telefon va «darslikni oling»
  const run: Run = { seen: new Set<bigint>(), batch: opts.batch ?? REMINDER_RULES.batch };
  const pay = await payReminders(api, now, run);
  const phone = await phoneReminders(api, now, run);
  const upsell = await upsellReminders(api, now, run);
  if (pay || phone || upsell) logger.info({ pay, phone, upsell }, "eslatmalar yuborildi");
  return { pay, phone, upsell };
}

/**
 * Hozir, soatga qaramasdan, hamma navbatdagilarga bir martada (src/scripts/sendReminders.ts — admin qo'lda ishga
 * tushiradi). Fon vazifasi bilan bir vaqtda ishlamaydi (bitta lease) — hech kim ikki marta olmaydi.
 */
export async function sendRemindersNow(api: Api) {
  return withLease("job:reminders", 30 * 60_000, () => processReminders(api, new Date(), { anyHour: true, batch: 1000 }));
}
