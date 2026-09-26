import { prisma } from "../db";
import { PAID_STATUSES } from "./orders";
import { percent } from "./campaignLinks";

/**
 * Marketing analitikasi: tanlangan davr [from, to) bo'yicha.
 * Kunlar Toshkent vaqti bo'yicha. Hamma hisob bazada (agregat so'rovlar), JS da katta massivlar yo'q.
 *
 * Funnel bosqichlari (botdagi haqiqiy tartib):
 *   bosish (/l/<kod>) → kirish (/start yoki Mini App) → ro'yxatdan o'tish (telefon) →
 *   kursni ko'rish → buyurtma (lead) → to'lov (purchase)
 * Unique foydalanuvchi — Telegram ID; takroriy /start yangi foydalanuvchi hisoblanmaydi.
 */
export interface Range {
  from: Date;
  to: Date;
}

const TZ = "Asia/Tashkent";
const START_EVENTS = ["start", "webapp_open"];
// Eski yozuvlar: botda kurs ko'rsatilishi "video" nomi bilan yozilgan (via siz)
const VIEW_CONDITION = `(e.name = 'product_view' OR (e.name = 'video' AND e.payload->>'via' IS NULL))`;

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

export interface Overview {
  totals: {
    users: number;
    newUsers: number;
    registered: number;
    leads: number;
    purchases: number;
    buyers: number;
    revenue: number;
    conversion: number;
  };
  funnel: { clicks: number; started: number; registered: number; viewed: number; ordered: number; purchased: number };
  series: { day: string; newUsers: number; registered: number; orders: number; purchases: number; revenue: number }[];
}

export async function overview({ from, to }: Range): Promise<Overview> {
  const paid = [...PAID_STATUSES];
  const [[t], [f], series] = await Promise.all([
    prisma.$queryRaw<
      { users: bigint; new_users: bigint; registered: bigint; leads: bigint; purchases: bigint; buyers: bigint; revenue: bigint | null }[]
    >`
      SELECT
        (SELECT count(*) FROM users WHERE NOT is_bot) AS users,
        (SELECT count(*) FROM users WHERE NOT is_bot AND created_at >= ${from} AND created_at < ${to}) AS new_users,
        (SELECT count(*) FROM users WHERE registered_at >= ${from} AND registered_at < ${to}) AS registered,
        (SELECT count(DISTINCT user_id) FROM orders WHERE created_at >= ${from} AND created_at < ${to}) AS leads,
        (SELECT count(*) FROM orders WHERE status::text = ANY(${paid}) AND paid_at >= ${from} AND paid_at < ${to}) AS purchases,
        (SELECT count(DISTINCT user_id) FROM orders WHERE status::text = ANY(${paid}) AND paid_at >= ${from} AND paid_at < ${to}) AS buyers,
        (SELECT sum(amount) FROM orders WHERE status::text = ANY(${paid}) AND paid_at >= ${from} AND paid_at < ${to}) AS revenue`,
    // Ketma-ket (kohorta) funnel: har bir bosqich — oldingi bosqichdan o'tganlar ichidan, shuning uchun
    // sonlar hech qachon oshmaydi. Kohorta — davrda botga yoki Mini App'ga kirgan foydalanuvchilar
    prisma.$queryRawUnsafe<{ clicks: bigint; started: bigint; registered: bigint; viewed: bigint; ordered: bigint; purchased: bigint }[]>(
      `WITH s AS (SELECT DISTINCT user_id FROM events WHERE user_id IS NOT NULL AND name = ANY($3) AND created_at >= $1 AND created_at < $2),
            r AS (SELECT s.user_id FROM s JOIN users u ON u.id = s.user_id WHERE u.phone IS NOT NULL),
            v AS (SELECT r.user_id FROM r WHERE EXISTS (
                    SELECT 1 FROM events e WHERE e.user_id = r.user_id AND ${VIEW_CONDITION} AND e.created_at >= $1 AND e.created_at < $2)),
            o AS (SELECT v.user_id FROM v WHERE EXISTS (
                    SELECT 1 FROM orders x WHERE x.user_id = v.user_id AND x.created_at >= $1 AND x.created_at < $2)),
            p AS (SELECT o.user_id FROM o WHERE EXISTS (
                    SELECT 1 FROM orders x WHERE x.user_id = o.user_id AND x.status::text = ANY($4) AND x.paid_at >= $1 AND x.paid_at < $2))
       SELECT
        (SELECT count(DISTINCT visitor_hash) FROM link_clicks WHERE created_at >= $1 AND created_at < $2) AS clicks,
        (SELECT count(*) FROM s) AS started, (SELECT count(*) FROM r) AS registered, (SELECT count(*) FROM v) AS viewed,
        (SELECT count(*) FROM o) AS ordered, (SELECT count(*) FROM p) AS purchased`,
      from,
      to,
      START_EVENTS,
      paid,
    ),
    prisma.$queryRaw<{ day: string; new_users: bigint; registered: bigint; orders: bigint; purchases: bigint; revenue: bigint | null }[]>`
      WITH days AS (
        SELECT generate_series(
          date_trunc('day', ${from}::timestamptz AT TIME ZONE ${TZ}),
          date_trunc('day', (${to}::timestamptz - interval '1 second') AT TIME ZONE ${TZ}),
          interval '1 day') AS d
      ),
      u AS (SELECT date_trunc('day', created_at AT TIME ZONE ${TZ}) AS d, count(*) AS c FROM users
            WHERE NOT is_bot AND created_at >= ${from} AND created_at < ${to} GROUP BY 1),
      r AS (SELECT date_trunc('day', registered_at AT TIME ZONE ${TZ}) AS d, count(*) AS c FROM users
            WHERE registered_at >= ${from} AND registered_at < ${to} GROUP BY 1),
      o AS (SELECT date_trunc('day', created_at AT TIME ZONE ${TZ}) AS d, count(*) AS c FROM orders
            WHERE created_at >= ${from} AND created_at < ${to} GROUP BY 1),
      p AS (SELECT date_trunc('day', paid_at AT TIME ZONE ${TZ}) AS d, count(*) AS c, sum(amount) AS s FROM orders
            WHERE status::text = ANY(${paid}) AND paid_at >= ${from} AND paid_at < ${to} GROUP BY 1)
      SELECT to_char(days.d, 'YYYY-MM-DD') AS day, u.c AS new_users, r.c AS registered, o.c AS orders, p.c AS purchases, p.s AS revenue
      FROM days LEFT JOIN u ON u.d = days.d LEFT JOIN r ON r.d = days.d LEFT JOIN o ON o.d = days.d LEFT JOIN p ON p.d = days.d
      ORDER BY days.d`,
  ]);

  const started = n(f.started);
  const buyers = n(t.buyers);
  const funnel = {
    clicks: n(f.clicks),
    started,
    registered: n(f.registered),
    viewed: n(f.viewed),
    ordered: n(f.ordered),
    purchased: n(f.purchased),
  };
  return {
    totals: {
      users: n(t.users),
      newUsers: n(t.new_users),
      registered: n(t.registered),
      leads: n(t.leads),
      purchases: n(t.purchases),
      buyers,
      revenue: n(t.revenue),
      // Kirganlarning qanchasi shu davrda sotib oldi (kohorta — funnel bilan bir xil)
      conversion: percent(funnel.purchased, started),
    },
    funnel,
    series: series.map((s) => ({
      day: s.day,
      newUsers: n(s.new_users),
      registered: n(s.registered),
      orders: n(s.orders),
      purchases: n(s.purchases),
      revenue: n(s.revenue),
    })),
  };
}

export interface CourseRow {
  productId: number;
  code: string;
  title: string;
  /** Qiziqqan: shu kurs linki/kodi bilan kirgan yoki kursni ko'rgan unique foydalanuvchilar */
  interested: number;
  started: number;
  viewed: number;
  leads: number;
  purchases: number;
  buyers: number;
  revenue: number;
  conversion: number;
}

/** Kurslar bo'yicha: kim kirdi (shu kurs linki yoki kodi bilan), ko'rdi, buyurtma berdi, to'ladi */
export async function courseStats({ from, to }: Range): Promise<CourseRow[]> {
  const paid = [...PAID_STATUSES];
  const rows = await prisma.$queryRawUnsafe<
    { id: number; code: string; title: string; deleted: boolean; interested: bigint; started: bigint; viewed: bigint; leads: bigint; purchases: bigint; buyers: bigint; revenue: bigint | null }[]
  >(
    // O'chirilgan kurs kodi "<kod>~<id>" bo'ladi — hodisalar asl kod bilan yozilgan (split_part)
    `SELECT p.id, split_part(p.code, '~', 1) AS code, p.title, p.deleted_at IS NOT NULL AS deleted,
       (SELECT count(DISTINCT e.user_id) FROM events e
          WHERE e.payload->>'product' = split_part(p.code, '~', 1) AND (e.name = ANY($3) OR ${VIEW_CONDITION})
            AND e.created_at >= $1 AND e.created_at < $2) AS interested,
       (SELECT count(DISTINCT e.user_id) FROM events e
          WHERE e.payload->>'product' = split_part(p.code, '~', 1) AND e.name = ANY($3) AND e.created_at >= $1 AND e.created_at < $2) AS started,
       (SELECT count(DISTINCT e.user_id) FROM events e
          WHERE e.payload->>'product' = split_part(p.code, '~', 1) AND ${VIEW_CONDITION} AND e.created_at >= $1 AND e.created_at < $2) AS viewed,
       (SELECT count(DISTINCT o.user_id) FROM orders o WHERE o.product_id = p.id AND o.created_at >= $1 AND o.created_at < $2) AS leads,
       (SELECT count(*) FROM orders o WHERE o.product_id = p.id AND o.status::text = ANY($4) AND o.paid_at >= $1 AND o.paid_at < $2) AS purchases,
       (SELECT count(DISTINCT o.user_id) FROM orders o WHERE o.product_id = p.id AND o.status::text = ANY($4) AND o.paid_at >= $1 AND o.paid_at < $2) AS buyers,
       (SELECT sum(o.amount) FROM orders o WHERE o.product_id = p.id AND o.status::text = ANY($4) AND o.paid_at >= $1 AND o.paid_at < $2) AS revenue
     FROM products p ORDER BY p.sort_order, p.id`,
    from,
    to,
    START_EVENTS,
    paid,
  );
  return rows
    // O'chirilgan kurs faqat shu davrda faollik bo'lsa ko'rsatiladi (tarixiy tushum)
    .filter((r) => !r.deleted || n(r.interested) || n(r.leads) || n(r.purchases))
    .map((r) => ({
    productId: r.id,
    code: r.code,
    title: r.deleted ? `${r.title} (o'chirilgan)` : r.title,
    interested: n(r.interested),
    started: n(r.started),
    viewed: n(r.viewed),
    leads: n(r.leads),
    purchases: n(r.purchases),
    buyers: n(r.buyers),
    revenue: n(r.revenue),
    // Katalogdan kelgan (linksiz) xaridorlar ham "qiziqqan" ichida (kursni ko'rgan) — 100% dan oshmaydi
    conversion: Math.min(100, percent(n(r.buyers), n(r.interested))),
  }));
}

export interface SegmentRow {
  course: string | null;
  source: string;
  campaign: string | null;
  clicks: number;
  users: number;
  registered: number;
  leads: number;
  purchases: number;
  revenue: number;
  conversion: number;
}

/**
 * Manba / kampaniya samaradorligi (kampaniya linklari bo'yicha). byCampaign=false — manba bo'yicha,
 * true — kurs × manba × kampaniya. Oxirida link orqali kelmagan ("organic") to'lovlar alohida qator.
 */
export async function segmentStats({ from, to }: Range, byCampaign: boolean): Promise<SegmentRow[]> {
  const paid = [...PAID_STATUSES];
  // Faqat ichki konstanta (foydalanuvchi kiritmaydi); qiymatlar $1..$3 parametr sifatida
  const select = byCampaign ? "p.title AS course, l.source, l.campaign" : "NULL AS course, l.source, NULL AS campaign";
  const rows = await prisma.$queryRawUnsafe<
    { course: string | null; source: string; campaign: string | null; clicks: bigint; users: bigint; registered: bigint; leads: bigint; purchases: bigint; revenue: bigint | null }[]
  >(
    `WITH links AS (SELECT l.id, ${select} FROM campaign_links l JOIN products p ON p.id = l.product_id)
     SELECT course, source, campaign,
       (SELECT count(DISTINCT c.visitor_hash) FROM link_clicks c WHERE c.link_id = ANY(array_agg(links.id)) AND c.created_at >= $1 AND c.created_at < $2) AS clicks,
       (SELECT count(DISTINCT v.user_id) FROM link_visits v WHERE v.link_id = ANY(array_agg(links.id)) AND v.created_at >= $1 AND v.created_at < $2) AS users,
       (SELECT count(DISTINCT v.user_id) FROM link_visits v JOIN users u ON u.id = v.user_id
          WHERE v.link_id = ANY(array_agg(links.id)) AND v.created_at >= $1 AND v.created_at < $2 AND u.phone IS NOT NULL) AS registered,
       (SELECT count(DISTINCT o.user_id) FROM orders o WHERE o.link_id = ANY(array_agg(links.id)) AND o.created_at >= $1 AND o.created_at < $2) AS leads,
       (SELECT count(*) FROM orders o WHERE o.link_id = ANY(array_agg(links.id)) AND o.status::text = ANY($3) AND o.paid_at >= $1 AND o.paid_at < $2) AS purchases,
       (SELECT sum(o.amount) FROM orders o WHERE o.link_id = ANY(array_agg(links.id)) AND o.status::text = ANY($3) AND o.paid_at >= $1 AND o.paid_at < $2) AS revenue
     FROM links GROUP BY course, source, campaign`,
    from,
    to,
    paid,
  );
  const result = rows
    .map((r) => ({
      course: r.course,
      source: r.source,
      campaign: r.campaign,
      clicks: n(r.clicks),
      users: n(r.users),
      registered: n(r.registered),
      leads: n(r.leads),
      purchases: n(r.purchases),
      revenue: n(r.revenue),
      conversion: percent(n(r.purchases), n(r.users)),
    }))
    .filter((r) => r.clicks || r.users || r.leads || r.purchases)
    .sort((a, b) => b.revenue - a.revenue || b.users - a.users);

  // Link orqali kelmagan (to'g'ridan-to'g'ri, eski linklar) — umumiy rasm to'liq bo'lishi uchun
  const [organic] = await prisma.$queryRaw<{ leads: bigint; purchases: bigint; revenue: bigint | null }[]>`
    SELECT
      (SELECT count(DISTINCT user_id) FROM orders WHERE link_id IS NULL AND created_at >= ${from} AND created_at < ${to}) AS leads,
      (SELECT count(*) FROM orders WHERE link_id IS NULL AND status::text = ANY(${paid}) AND paid_at >= ${from} AND paid_at < ${to}) AS purchases,
      (SELECT sum(amount) FROM orders WHERE link_id IS NULL AND status::text = ANY(${paid}) AND paid_at >= ${from} AND paid_at < ${to}) AS revenue`;
  if (n(organic.leads) || n(organic.purchases)) {
    result.push({
      course: null,
      source: "organic",
      campaign: null,
      clicks: 0,
      users: 0,
      registered: 0,
      leads: n(organic.leads),
      purchases: n(organic.purchases),
      revenue: n(organic.revenue),
      conversion: 0,
    });
  }
  return result;
}
