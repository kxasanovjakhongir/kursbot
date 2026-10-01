import type { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { formatDate, formatDateTime, formatSum } from "../../lib/format";
import { PAID_STATUSES } from "../orders";
import { buildUserWhere, type UserFilter } from "../users";

/** Bir so'rovda olinadigan foydalanuvchilar soni: xotira ~ BATCH × (foydalanuvchi + buyurtmalari) */
export const EXPORT_BATCH = 500;

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  new: "To'lov kutilmoqda",
  receipt_sent: "Chek tekshirilmoqda",
  rejected: "Rad etilgan",
  approved: "To'langan",
  joined: "To'langan (kanalda)",
  expired: "Muddati o'tgan",
  cancelled: "Bekor qilingan",
  refunded: "Qaytarilgan",
};

/** Export qatori — faqat bazada mavjud ma'lumotlar */
export interface ExportRow {
  id: string;
  telegramId: string;
  username: string;
  firstName: string;
  lastName: string;
  phone: string;
  createdAt: Date;
  /** Telefon ulashgan (ro'yxatdan o'tgan) vaqt */
  registeredAt: Date | null;
  lastSeenAt: Date;
  courses: string;
  purchaseCount: number;
  totalPaid: number;
  /** Oxirgi buyurtma holati */
  paymentStatus: string;
  purchaseDates: string;
  accountStatus: string;
  language: string;
  source: string;
}

export interface ExportSummary {
  generatedAt: Date;
  total: number;
  buyers: number;
  paidOrders: number;
  revenue: number;
  /** Tanlangan filtrlar (hujjat sarlavhasida ko'rsatiladi) */
  filters: string[];
}

export interface ExportSource {
  summary: ExportSummary;
  batches: () => AsyncGenerator<ExportRow[]>;
}

function accountStatus(u: { isBanned: boolean; isBlocked: boolean }): string {
  if (u.isBanned) return "Cheklangan";
  if (u.isBlocked) return "Botni bloklagan";
  return "Faol";
}

async function describeFilters(f: UserFilter): Promise<string[]> {
  const out: string[] = [];
  if (f.purchased === true) out.push("Faqat kurs sotib olganlar");
  if (f.purchased === false) out.push("Faqat sotib olmaganlar");
  if (f.boughtProductId) {
    const p = await prisma.product.findUnique({ where: { id: f.boughtProductId }, select: { title: true } });
    out.push(`Sotib olgan kursi: ${p?.title ?? `#${f.boughtProductId}`}`);
  }
  if (f.paymentStatus) out.push(`To'lov holati: ${ORDER_STATUS_LABEL[f.paymentStatus]}`);
  if (f.from || f.to) {
    // "to" — keyingi kun boshi (eksklyuziv), hujjatda inklyuziv oxirgi kun ko'rsatiladi
    const to = f.to ? formatDate(new Date(f.to.getTime() - 1)) : "…";
    out.push(`Ro'yxatdan o'tgan sana: ${f.from ? formatDate(f.from) : "…"} — ${to}`);
  }
  if (f.status !== "all") out.push(`Holat: ${{ active: "faol", blocked: "botni bloklagan", banned: "cheklangan" }[f.status]}`);
  if (f.registered !== undefined) out.push(f.registered ? "Telefon raqami bor" : "Telefon raqami yo'q");
  if (f.productId) out.push(`Qiziqqan kursi (link): #${f.productId}`);
  if (f.source) out.push(`Manba: ${f.source}`);
  if (f.campaign) out.push(`Kampaniya: ${f.campaign}`);
  if (f.q) out.push(`Qidiruv: ${f.q}`);
  return out.length ? out : ["Barcha foydalanuvchilar"];
}

/**
 * Export manbasi: umumiy statistika (bir nechta agregat so'rov) va foydalanuvchilar — ID bo'yicha
 * kursor bilan bo'laklab (OFFSET siz, katta jadvalda ham tez). Har bo'lak uchun buyurtmalar bitta
 * so'rov bilan olinadi (N+1 yo'q). Butun baza hech qachon xotiraga birdan yuklanmaydi.
 */
export async function userExportSource(filter: UserFilter, batchSize = EXPORT_BATCH): Promise<ExportSource> {
  const where = await buildUserWhere(filter);
  const paidWhere: Prisma.OrderWhereInput = { status: { in: PAID_STATUSES }, user: where };
  const [total, buyers, revenue, filters] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.count({ where: { AND: [where, { orders: { some: { status: { in: PAID_STATUSES } } } }] } }),
    prisma.order.aggregate({ where: paidWhere, _sum: { amount: true }, _count: { _all: true } }),
    describeFilters(filter),
  ]);
  const summary: ExportSummary = {
    generatedAt: new Date(),
    total,
    buyers,
    paidOrders: revenue._count._all,
    revenue: revenue._sum.amount ?? 0,
    filters,
  };

  // Kursor: oldingi bo'lakning oxirgi ID sidan keyingilar (OFFSET siz)
  const page = (after: bigint | null) =>
    prisma.user.findMany({
      where: after === null ? where : { AND: [where, { id: { gt: after } }] },
      orderBy: { id: "asc" },
      take: batchSize,
      select: {
        id: true,
        telegramId: true,
        username: true,
        firstName: true,
        lastName: true,
        phone: true,
        createdAt: true,
        registeredAt: true,
        lastSeenAt: true,
        isBanned: true,
        isBlocked: true,
        language: true,
        languageCode: true,
        firstSource: true,
      },
    });

  async function* batches(): AsyncGenerator<ExportRow[]> {
    let cursor: bigint | null = null;
    for (;;) {
      const users = await page(cursor);
      if (!users.length) return;
      cursor = users[users.length - 1].id;

      const orders = await prisma.order.findMany({
        where: { userId: { in: users.map((u) => u.id) } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { userId: true, status: true, amount: true, paidAt: true, product: { select: { title: true } } },
      });
      const byUser = new Map<bigint, typeof orders>();
      for (const o of orders) {
        const list = byUser.get(o.userId);
        if (list) list.push(o);
        else byUser.set(o.userId, [o]);
      }

      yield users.map((u) => {
        const own = byUser.get(u.id) ?? [];
        const paid = own.filter((o) => PAID_STATUSES.includes(o.status));
        const last = own.at(-1);
        return {
          id: u.id.toString(),
          telegramId: u.telegramId.toString(),
          username: u.username ? `@${u.username}` : "",
          firstName: u.firstName ?? "",
          lastName: u.lastName ?? "",
          phone: u.phone ?? "",
          createdAt: u.createdAt,
          registeredAt: u.registeredAt,
          lastSeenAt: u.lastSeenAt,
          courses: [...new Set(paid.map((o) => o.product.title))].join("; "),
          purchaseCount: paid.length,
          totalPaid: paid.reduce((s, o) => s + o.amount, 0),
          paymentStatus: last ? ORDER_STATUS_LABEL[last.status] : "Buyurtma yo'q",
          purchaseDates: paid.map((o) => (o.paidAt ? `${o.product.title}: ${formatDateTime(o.paidAt)}` : o.product.title)).join("; "),
          accountStatus: accountStatus(u),
          language: u.language ?? u.languageCode ?? "",
          source: u.firstSource ?? "",
        };
      });
      if (users.length < batchSize) return;
    }
  }

  return { summary, batches };
}

/** Hujjat sarlavhasidagi statistika qatorlari (Word va PDF) */
export function summaryLines(s: ExportSummary): [string, string][] {
  return [
    ["Eksport vaqti", `${formatDateTime(s.generatedAt)} (Toshkent)`],
    ["Filtr", s.filters.join("; ")],
    ["Foydalanuvchilar", String(s.total)],
    ["Kurs sotib olganlar", String(s.buyers)],
    ["Sotib olmaganlar", String(s.total - s.buyers)],
    ["To'langan buyurtmalar", String(s.paidOrders)],
    ["Umumiy xarid summasi", formatSum(s.revenue)],
  ];
}

/** XML 1.0 da taqiqlangan belgilar (boshqaruv belgilari, juftsiz surrogatlar) olib tashlanadi */
export function cleanText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

/** Toshkent vaqti (UTC+5, yozgi vaqt yo'q) — Excel sanalari vaqt mintaqasisiz saqlanadi */
export function tashkentWallClock(d: Date): Date {
  return new Date(d.getTime() + 5 * 3600_000);
}
