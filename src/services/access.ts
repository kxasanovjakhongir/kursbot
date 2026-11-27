import type { Api } from "grammy";
import type { AccessGrant, Order, Product, User } from "@prisma/client";
import { prisma } from "../db";
import { logger } from "../lib/logger";
import { componentProducts } from "./products";
import { markJoined } from "./orders";
import { getSettings } from "./settings";

export type GrantWithProduct = AccessGrant & { product: Product };

/** Link nomi (kanal sozlamalarida ko'rinadi): buyurtma raqami yoki «sinov» */
function linkName(orderId: bigint | null, userTgId: bigint): string {
  return `${orderId ? `#${orderId}` : "sinov"} u${userTgId}`.slice(0, 32);
}

async function createInviteLink(api: Api, product: Product, orderId: bigint | null, userTgId: bigint, until?: Date) {
  if (!product.channelId) return null;
  const settings = await getSettings();
  let expire = Math.floor(Date.now() / 1000) + settings.invite_link_days * 86400;
  // Sinov kirishi: link ham sinov tugashi bilan yaroqsiz bo'ladi
  if (until) expire = Math.min(expire, Math.floor(until.getTime() / 1000));
  // Qo'shilish so'rovi rejimi: bot faqat link egasini qabul qiladi (TZ 5.7, BR-15)
  const link = await api.createChatInviteLink(Number(product.channelId), {
    creates_join_request: true,
    expire_date: expire,
    name: linkName(orderId, userTgId),
  });
  return { url: link.invite_link, expiresAt: new Date(expire * 1000) };
}

/**
 * Tasdiqlangan buyurtma uchun kirish beradi: har bir kanal uchun shaxsiy link.
 * To'plam bo'lsa — tarkibidagi har bir darslik uchun alohida (TZ 3.1).
 */
export async function grantAccess(api: Api, order: Order, userTgId: bigint): Promise<GrantWithProduct[]> {
  const product = await prisma.product.findUniqueOrThrow({ where: { id: order.productId } });
  const parts = await componentProducts(product);
  const result: GrantWithProduct[] = [];
  for (const p of parts) {
    // Allaqachon faol kirish bo'lsa takrorlanmaydi
    const existing = await prisma.accessGrant.findFirst({
      where: { userId: order.userId, productId: p.id, revokedAt: null },
      include: { product: true },
    });
    if (existing?.trial) {
      // Sinovdan keyin sotib oldi: kirish oddiyga aylanadi (kanaldan chiqarilmaydi, link o'sha)
      result.push(
        await prisma.accessGrant.update({
          where: { id: existing.id },
          data: {
            trial: false,
            orderId: order.id,
            expiresAt: p.accessDays ? new Date(Date.now() + p.accessDays * 86400_000) : null,
            expiryRemindedAt: null,
          },
          include: { product: true },
        }),
      );
      continue;
    }
    if (existing) {
      result.push(existing);
      continue;
    }
    let link: Awaited<ReturnType<typeof createInviteLink>> = null;
    try {
      link = await createInviteLink(api, p, order.id, userTgId);
    } catch (err) {
      logger.error({ err, productId: p.id, orderId: order.id.toString() }, "invite link yaratilmadi");
    }
    const grant = await prisma.accessGrant.create({
      data: {
        userId: order.userId,
        productId: p.id,
        orderId: order.id,
        inviteLink: link?.url ?? null,
        linkExpiresAt: link?.expiresAt ?? null,
        expiresAt: p.accessDays ? new Date(Date.now() + p.accessDays * 86400_000) : null,
      },
      include: { product: true },
    });
    result.push(grant);
  }
  return result;
}

/** Kurs sahifasidagi «🔗 Kanal havolasi» — linkni qayta olish: eski link bekor qilinadi, yangisi yaratiladi */
export async function refreshInviteLink(api: Api, grantId: bigint, userTgId: bigint): Promise<GrantWithProduct | null> {
  const grant = await prisma.accessGrant.findUnique({ where: { id: grantId }, include: { product: true, user: true } });
  if (!grant || grant.revokedAt || grant.user.telegramId !== userTgId) return null;
  if (grant.inviteLink && grant.linkExpiresAt && grant.linkExpiresAt > new Date() && !grant.joinedAt) {
    return grant;
  }
  if (grant.inviteLink && grant.product.channelId) {
    await api.revokeChatInviteLink(Number(grant.product.channelId), grant.inviteLink).catch(() => undefined);
  }
  // Bot kanal huquqini yo'qotgan bo'lsa — null (mijozga "admin bilan bog'laning", adminlar xatoni panelda ko'radi)
  const link = await createInviteLink(api, grant.product, grant.orderId, userTgId, grant.trial && grant.expiresAt ? grant.expiresAt : undefined).catch((err: unknown) => {
    logger.error({ err, grantId: grantId.toString(), productId: grant.productId }, "kanal linki yangilanmadi");
    return null;
  });
  if (!link) return null;
  return prisma.accessGrant.update({
    where: { id: grant.id },
    data: { inviteLink: link.url, linkExpiresAt: link.expiresAt },
    include: { product: true },
  });
}

export type TrialResult =
  | { kind: "ok"; grants: GrantWithProduct[]; expiresAt: Date }
  | { kind: "owned" }
  | { kind: "no_channel" };

/**
 * Sinov uchun ochish (admin panel): buyurtmasiz, `days` kunlik kirish. Har bir kanalga shaxsiy link —
 * qo'shilish so'rovi faqat shu odamdan qabul qilinadi (decideJoinRequest). Muddat tugasa processExpiredGrants
 * kanaldan chiqaradi. Sinov allaqachon bo'lsa — muddati yangilanadi.
 */
export async function grantTrial(api: Api, user: User, product: Product, days: number): Promise<TrialResult> {
  const parts = (await componentProducts(product)).filter((p) => p.channelId);
  if (parts.length === 0) return { kind: "no_channel" };
  const expiresAt = new Date(Date.now() + days * 86400_000);
  const active = await prisma.accessGrant.findMany({ where: { userId: user.id, productId: { in: parts.map((p) => p.id) }, revokedAt: null } });
  if (parts.every((p) => active.some((g) => g.productId === p.id && !g.trial))) return { kind: "owned" };

  const grants: GrantWithProduct[] = [];
  for (const p of parts) {
    const existing = active.find((g) => g.productId === p.id);
    if (existing && !existing.trial) continue; // bu qismi sotib olingan
    // Eski sinov linki bekor qilinadi — yangisi yangi muddat bilan
    if (existing?.inviteLink) await api.revokeChatInviteLink(Number(p.channelId), existing.inviteLink).catch(() => undefined);
    const link = await createInviteLink(api, p, null, user.telegramId, expiresAt);
    // Eslatma (3 kun oldin) sinov uchun kerak emas — darhol belgilanadi
    const data = { inviteLink: link?.url ?? null, linkExpiresAt: link?.expiresAt ?? null, expiresAt, expiryRemindedAt: new Date() };
    grants.push(
      existing
        ? await prisma.accessGrant.update({ where: { id: existing.id }, data, include: { product: true } })
        : await prisma.accessGrant.create({ data: { ...data, userId: user.id, productId: p.id, trial: true }, include: { product: true } }),
    );
  }
  return { kind: "ok", grants, expiresAt };
}

export type GrantWithOwner = GrantWithProduct & { user: User };

export type JoinDecision =
  | { kind: "approve"; grant: GrantWithOwner; orderJoined: boolean }
  | { kind: "decline"; reason: "unknown_link" | "foreign_user" | "revoked" | "expired"; grant: GrantWithOwner | null };

/**
 * Qo'shilish so'rovi: so'rov yuborgan odam ID si link egasi bilan mos bo'lsagina qabul (TZ 5.7, BR-15, BR-16).
 * Bu funksiya faqat qaror qabul qiladi va bazani yangilaydi; Telegram API chaqiruvini handler bajaradi.
 */
export async function decideJoinRequest(inviteLink: string | undefined, fromTgId: bigint): Promise<JoinDecision> {
  if (!inviteLink) return { kind: "decline", reason: "unknown_link", grant: null };
  const grant = await prisma.accessGrant.findUnique({
    where: { inviteLink },
    include: { product: true, user: true },
  });
  if (!grant) return { kind: "decline", reason: "unknown_link", grant: null };
  if (grant.user.telegramId !== fromTgId) return { kind: "decline", reason: "foreign_user", grant };
  if (grant.revokedAt || grant.user.isBanned) return { kind: "decline", reason: "revoked", grant };
  if (grant.expiresAt && grant.expiresAt < new Date()) return { kind: "decline", reason: "expired", grant };

  await prisma.accessGrant.update({ where: { id: grant.id }, data: { joinedAt: new Date() } });
  const orderJoined = grant.orderId ? await markJoined(grant.orderId) : false;
  return { kind: "approve", grant, orderJoined };
}

export async function listUserGrants(userId: bigint): Promise<GrantWithProduct[]> {
  return prisma.accessGrant.findMany({
    where: { userId, revokedAt: null },
    include: { product: true },
    orderBy: { createdAt: "asc" },
  });
}
