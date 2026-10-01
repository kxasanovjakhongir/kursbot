import { randomInt } from "node:crypto";
import { Prisma, type CampaignLink, type LinkVisitVia, type Product, type User } from "@prisma/client";
import { prisma } from "../db";
import { config } from "../config";
import { parseStartPayload } from "../lib/deeplink";
import { getActiveProduct } from "./products";
import { PAID_STATUSES } from "./orders";

/**
 * Kampaniya (deep link) havolalari: t.me/<bot>?start=<kod>.
 * Bot kodni shu servis orqali aniqlaydi — baza yagona manba.
 *
 * Kod formati: kichik lotin harflari, raqam va "-" (3–32). "_" ishlatilmaydi — eski
 * "<mahsulot>_<manba>" (masalan 4b_instagram) havolalari avvalgidek ishlashi uchun.
 */
export const LINK_CODE_RE = /^[a-z0-9][a-z0-9-]{2,31}$/;

/** Bir foydalanuvchining bir linkni qayta-qayta bosishi shu oraliqda bitta kirish hisoblanadi */
const VISIT_DEDUP_MS = 30 * 60_000;

// O'xshash belgilar (0/o, 1/l) yo'q — reklamada qo'lda yozilsa ham adashtirilmaydi
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function generateLinkCode(): string {
  let code = "c";
  for (let i = 0; i < 6; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

export type LinkWithProduct = CampaignLink & { product: Product };

export type Entry =
  | { kind: "none" }
  | { kind: "product"; product: Product; source: string; link: LinkWithProduct | null }
  | { kind: "unavailable" };

/**
 * start parametrini aniqlaydi. Parametrga ishonilmaydi: format tekshiriladi,
 * kod bazadan qidiriladi, link va mahsulot faol bo'lishi shart.
 */
export async function resolveEntry(payload: string | null | undefined): Promise<Entry> {
  const raw = (payload ?? "").trim();
  if (!raw) return { kind: "none" };
  if (raw.length > 64 || !/^[A-Za-z0-9_-]+$/.test(raw)) return { kind: "unavailable" };

  const code = raw.toLowerCase();
  if (LINK_CODE_RE.test(code)) {
    const link = await prisma.campaignLink.findUnique({ where: { code }, include: { product: true } });
    if (link) {
      return link.isActive && link.product.isActive ? { kind: "product", product: link.product, source: link.source, link } : { kind: "unavailable" };
    }
  }
  // Eski format: <mahsulot>_<manba>
  const { productCode, source } = parseStartPayload(raw);
  const product = await getActiveProduct(productCode);
  return product ? { kind: "product", product, source, link: null } : { kind: "unavailable" };
}

/**
 * Link orqali kirish: foydalanuvchi kontekstiga yoziladi (keyingi buyurtma shu linkka bog'lanadi)
 * va statistika uchun kirish qayd etiladi. Takroriy bosish (spam) statistikani buzmaydi.
 */
export async function recordLinkVisit(user: Pick<User, "id">, link: CampaignLink, via: LinkVisitVia, isNewUser: boolean): Promise<void> {
  const now = new Date();
  const recent = await prisma.linkVisit.findFirst({
    where: { userId: user.id, linkId: link.id, createdAt: { gt: new Date(now.getTime() - VISIT_DEDUP_MS) } },
    select: { id: true },
  });
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { lastLinkId: link.id, lastLinkAt: now } }),
    // First-touch: faqat birinchi link yoziladi (atomik — parallel so'rovlar ham qayta yozmaydi)
    prisma.user.updateMany({ where: { id: user.id, firstLinkId: null }, data: { firstLinkId: link.id } }),
    ...(recent ? [] : [prisma.linkVisit.create({ data: { linkId: link.id, userId: user.id, via, isNewUser } })]),
  ]);
}

/** Tracking redirect uchun ochiq manzil (PUBLIC_URL) */
function publicOrigin(): string | null {
  return config.PUBLIC_URL ? config.PUBLIC_URL.replace(/\/$/, "") : null;
}

/** bot — to'g'ridan-to'g'ri Telegram linki; tracked — bosishlarni ham sanaydigan redirect (reklama uchun tavsiya) */
export function linkUrls(code: string, username: string | null): { bot: string | null; tracked: string | null } {
  if (!username) return { bot: null, tracked: null };
  const origin = publicOrigin();
  return {
    bot: `https://t.me/${username}?start=${code}`,
    tracked: origin ? `${origin}/l/${code}` : null,
  };
}

// ---------- Admin: boshqaruv va statistika ----------

export class LinkInputError extends Error {}

export interface CreateLinkInput {
  productId: number;
  name: string | null;
  source: string;
  campaign: string | null;
  medium: string | null;
  /** Ixtiyoriy o'z kodi (masalan "frontend-sep"); bo'lmasa tasodifiy yaratiladi */
  code: string | null;
  createdById: number;
}

async function codeTaken(code: string): Promise<boolean> {
  const [link, product] = await Promise.all([
    prisma.campaignLink.findUnique({ where: { code }, select: { id: true } }),
    // Mahsulot kodi bilan bir xil bo'lsa, eski format bilan chalkashadi
    prisma.product.findUnique({ where: { code }, select: { id: true } }),
  ]);
  return !!link || !!product;
}

export async function createLink(input: CreateLinkInput): Promise<CampaignLink> {
  const product = await prisma.product.findFirst({ where: { id: input.productId, deletedAt: null }, select: { id: true } });
  if (!product) throw new LinkInputError("Mahsulot topilmadi");

  if (input.code) {
    if (!LINK_CODE_RE.test(input.code)) throw new LinkInputError("Kod: 3–32 ta kichik lotin harfi, raqam yoki «-» (masalan: frontend-sep)");
    if (await codeTaken(input.code)) throw new LinkInputError(`«${input.code}» kodi band (boshqa link yoki mahsulot kodi)`);
  }
  // Tasodifiy kod to'qnashuvi juda kam; baribir bir necha marta urinib ko'riladi
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = input.code ?? generateLinkCode();
    if (!input.code && (await codeTaken(code))) continue;
    try {
      return await prisma.campaignLink.create({
        data: { code, name: input.name, productId: input.productId, source: input.source, campaign: input.campaign, medium: input.medium, createdById: input.createdById },
      });
    } catch (err) {
      // Parallel so'rov xuddi shu kodni oldi (unique indeks)
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && !input.code) continue;
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new LinkInputError(`«${input.code}» kodi band`);
      throw err;
    }
  }
  throw new LinkInputError("Kod yaratib bo'lmadi, qayta urinib ko'ring");
}

/**
 * Link funnel'i (butun davr uchun). Kohorta — link orqali kirgan foydalanuvchilar:
 * bosish → kirish (/start) → ro'yxatdan o'tish (telefon) → kursni ko'rish → buyurtma → to'lov.
 */
export interface LinkStats {
  clicks: number;
  uniqueClicks: number;
  visits: number;
  users: number;
  newUsers: number;
  registered: number;
  viewed: number;
  orders: number;
  paid: number;
  buyers: number;
  revenue: number;
  /** Xaridorlar / link orqali kelgan foydalanuvchilar, % */
  conversion: number;
}

interface StatsRow {
  id: number;
  clicks: bigint;
  unique_clicks: bigint;
  visits: bigint;
  users: bigint;
  new_users: bigint;
  registered: bigint;
  viewed: bigint;
  orders: bigint;
  paid: bigint;
  buyers: bigint;
  revenue: bigint | null;
}

export const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 10000) / 100 : 0);

/** Bir nechta link statistikasi bitta so'rovda (indekslar: link_visits, link_clicks, orders(link_id), events(product)) */
export async function linkStats(ids: number[]): Promise<Map<number, LinkStats>> {
  const result = new Map<number, LinkStats>();
  if (ids.length === 0) return result;
  const paid = [...PAID_STATUSES];
  const rows = await prisma.$queryRaw<StatsRow[]>`
    SELECT l.id,
      (SELECT count(*) FROM link_clicks c WHERE c.link_id = l.id) AS clicks,
      (SELECT count(DISTINCT c.visitor_hash) FROM link_clicks c WHERE c.link_id = l.id) AS unique_clicks,
      (SELECT count(*) FROM link_visits v WHERE v.link_id = l.id) AS visits,
      (SELECT count(DISTINCT v.user_id) FROM link_visits v WHERE v.link_id = l.id) AS users,
      (SELECT count(DISTINCT v.user_id) FROM link_visits v WHERE v.link_id = l.id AND v.is_new_user) AS new_users,
      (SELECT count(DISTINCT v.user_id) FROM link_visits v JOIN users u ON u.id = v.user_id
         WHERE v.link_id = l.id AND u.phone IS NOT NULL) AS registered,
      (SELECT count(DISTINCT e.user_id) FROM events e
         WHERE e.payload->>'product' = split_part(p.code, '~', 1) AND e.name = 'product_view'
           AND e.user_id IN (SELECT v.user_id FROM link_visits v WHERE v.link_id = l.id)) AS viewed,
      (SELECT count(*) FROM orders o WHERE o.link_id = l.id) AS orders,
      (SELECT count(*) FROM orders o WHERE o.link_id = l.id AND o.status::text = ANY(${paid})) AS paid,
      (SELECT count(DISTINCT o.user_id) FROM orders o WHERE o.link_id = l.id AND o.status::text = ANY(${paid})) AS buyers,
      (SELECT sum(o.amount) FROM orders o WHERE o.link_id = l.id AND o.status::text = ANY(${paid})) AS revenue
    FROM campaign_links l JOIN products p ON p.id = l.product_id
    WHERE l.id = ANY(${ids})`;
  for (const r of rows) {
    const users = Number(r.users);
    const buyers = Number(r.buyers);
    result.set(r.id, {
      clicks: Number(r.clicks),
      uniqueClicks: Number(r.unique_clicks),
      visits: Number(r.visits),
      users,
      newUsers: Number(r.new_users),
      registered: Number(r.registered),
      viewed: Number(r.viewed),
      orders: Number(r.orders),
      paid: Number(r.paid),
      buyers,
      revenue: Number(r.revenue ?? 0),
      conversion: percent(buyers, users),
    });
  }
  return result;
}
