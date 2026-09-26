import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { GrammyError, type Api } from "grammy";
import type { Express } from "express";
import { prisma } from "../src/db";
import { createApp } from "../src/api/app";
import { decideJoinRequest } from "../src/services/access";
import { processExpiredGrants, remindExpiringGrants } from "../src/services/membership";
import { createPanelUser } from "../src/services/panelUsers";

const enabled = !!process.env.TEST_DATABASE_URL;

const OK_CHANNEL = -1009999999; // bot admin
const NO_RIGHTS_CHANNEL = -1008888888; // bot huquqi yo'q

// Soxta Telegram API: kanaldan chiqarish (ban/unban) va xabarlar yoziladi
const kicked: string[] = [];
const messaged: number[] = [];
const noRights = (method: string) =>
  new GrammyError("Call failed", { ok: false, error_code: 400, description: "Bad Request: not enough rights to restrict/unrestrict chat member" }, method, {});

const fakeApi = {
  token: "test",
  getMe: async () => ({ id: 42, is_bot: true, first_name: "Test", username: "test_bot" }),
  sendMessage: async (chatId: number) => {
    messaged.push(chatId);
    return { message_id: messaged.length, chat: { id: chatId } };
  },
  banChatMember: async (chatId: number, userId: number) => {
    if (chatId === NO_RIGHTS_CHANNEL) throw noRights("banChatMember");
    kicked.push(`ban:${chatId}:${userId}`);
    return true;
  },
  unbanChatMember: async (chatId: number, userId: number) => {
    kicked.push(`unban:${chatId}:${userId}`);
    return true;
  },
  revokeChatInviteLink: async () => true,
} as unknown as Api;

describe.skipIf(!enabled)("yopiq kanal a'zoligi: chiqarish, muddat, cheklash", () => {
  let app: Express;
  let auth: { Authorization: string };
  let userId = 0n;
  let okGrant = 0n;
  let noRightsGrant = 0n;

  const grant = (id: bigint) => prisma.accessGrant.findUniqueOrThrow({ where: { id } });
  const url = (grantId: bigint, action: string) => `/api/telegram-users/${userId}/grants/${grantId}/${action}`;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE notifications, activity_logs, panel_users, access_grants, orders, products, users RESTART IDENTITY CASCADE`,
    );
    await createPanelUser({ email: "admin@test.uz", name: "Admin", password: "adminpass1", role: "admin" });
    app = createApp({ runtime: { api: fakeApi, mode: "polling", tokenSource: "env", isRunning: () => true } });
    auth = { Authorization: `Bearer ${(await request(app).post("/api/auth/login").send({ email: "admin@test.uz", password: "adminpass1" })).body.token}` };

    const user = await prisma.user.create({ data: { telegramId: 3001n, firstName: "Sardor" } });
    userId = user.id;
    const [ok, bad] = await Promise.all([
      prisma.product.create({ data: { code: "ok", title: "Kanal A", price: 100, channelId: BigInt(OK_CHANNEL) } }),
      prisma.product.create({ data: { code: "bad", title: "Kanal B", price: 100, channelId: BigInt(NO_RIGHTS_CHANNEL) } }),
    ]);
    for (const p of [ok, bad]) {
      const order = await prisma.order.create({ data: { userId, productId: p.id, amount: 100, status: "joined", expiresAt: new Date() } });
      const g = await prisma.accessGrant.create({ data: { userId, productId: p.id, orderId: order.id, joinedAt: new Date(), inviteLink: `https://t.me/+${p.code}` } });
      if (p.code === "ok") okGrant = g.id;
      else noRightsGrant = g.id;
    }
  });
  beforeEach(() => {
    kicked.length = 0;
    messaged.length = 0;
  });
  afterAll(() => prisma.$disconnect());

  it("muddat: kun bilan belgilanadi, o'tgan sana rad etiladi, foydalanuvchiga xabar boradi", async () => {
    const res = await request(app).put(url(okGrant, "expiry")).set(auth).send({ days: 30 });
    expect(res.status).toBe(200);
    const g = await grant(okGrant);
    expect(Math.round((g.expiresAt!.getTime() - Date.now()) / 86400_000)).toBe(30);
    expect(messaged).toEqual([3001]);

    expect((await request(app).put(url(okGrant, "expiry")).set(auth).send({ expiresAt: "2020-01-01T00:00:00Z" })).status).toBe(400);
    expect((await request(app).put(url(okGrant, "expiry")).set(auth).send({})).status).toBe(400);
    // Muddatsiz
    await request(app).put(url(okGrant, "expiry")).set(auth).send({ expiresAt: null });
    expect((await grant(okGrant)).expiresAt).toBeNull();
  });

  it("kanaldan chiqarish: bot huquqi yo'q bo'lsa 502 va kirish saqlanadi; bo'lsa — ban+unban, xabar", async () => {
    const fail = await request(app).post(url(noRightsGrant, "revoke")).set(auth);
    expect(fail.status).toBe(502);
    expect(fail.body.error).toContain("Kanal B");
    expect((await grant(noRightsGrant)).revokedAt).toBeNull();

    expect((await request(app).post(url(okGrant, "revoke")).set(auth)).status).toBe(200);
    expect(kicked).toEqual([`ban:${OK_CHANNEL}:3001`, `unban:${OK_CHANNEL}:3001`]);
    const g = await grant(okGrant);
    expect(g.revokedAt).not.toBeNull();
    expect(g.revokeReason).toBe("removed");
    expect(messaged).toEqual([3001]);
    expect((await request(app).post(url(okGrant, "revoke")).set(auth)).status).toBe(409);

    // Chiqarilgan foydalanuvchi eski link bilan qaytib kira olmaydi
    const decision = await decideJoinRequest("https://t.me/+ok", 3001n);
    expect(decision).toMatchObject({ kind: "decline", reason: "revoked" });
  });

  it("chiqarilgan kirishga muddat berilsa — tiklanadi (yangi link keyin olinadi)", async () => {
    const res = await request(app).put(url(okGrant, "expiry")).set(auth).send({ days: 10 });
    expect(res.status).toBe(200);
    const g = await grant(okGrant);
    expect(g).toMatchObject({ revokedAt: null, revokeReason: null, joinedAt: null, inviteLink: null });
  });

  it("muddat tugaganda avtomatik chiqariladi; huquq yo'q kanal keyingi safarga qoladi", async () => {
    const past = new Date(Date.now() - 60_000);
    await prisma.accessGrant.updateMany({ where: { id: { in: [okGrant, noRightsGrant] } }, data: { expiresAt: past } });

    expect(await processExpiredGrants(fakeApi)).toEqual({ removed: 1, pending: 1 });
    expect((await grant(okGrant)).revokeReason).toBe("expired");
    expect((await grant(noRightsGrant)).revokedAt).toBeNull();
    expect(kicked).toContain(`ban:${OK_CHANNEL}:3001`);
    expect(messaged).toEqual([3001]);
    // Qayta ishga tushganda chiqarilgan qayta ishlanmaydi
    expect(await processExpiredGrants(fakeApi)).toEqual({ removed: 0, pending: 1 });
  });

  it("muddat tugashiga 3 kun qolganda bir marta eslatma", async () => {
    await prisma.accessGrant.update({ where: { id: noRightsGrant }, data: { expiresAt: new Date(Date.now() + 2 * 86400_000), expiryRemindedAt: null } });
    expect(await remindExpiringGrants(fakeApi)).toBe(1);
    expect(await remindExpiringGrants(fakeApi)).toBe(0);
    expect(messaged).toEqual([3001]);
  });

  it("cheklash kanallardan chiqaradi; cheklov olib tashlansa kirish tiklanadi", async () => {
    // Faol kirish: ok kanali (tiklangan), bad kanali — huquq yo'q
    await request(app).put(url(okGrant, "expiry")).set(auth).send({ days: 5 });
    messaged.length = 0;

    const ban = await request(app).post(`/api/telegram-users/${userId}/ban`).set(auth).send({ removeFromChannels: true });
    expect(ban.status).toBe(200);
    expect(ban.body.channels).toEqual({ removed: 1, failed: ["Kanal B"] });
    expect((await grant(okGrant)).revokeReason).toBe("banned");
    expect(messaged).toEqual([]); // cheklangan foydalanuvchiga bot yozmaydi

    // Cheklangan foydalanuvchining kirishini tiklab bo'lmaydi
    expect((await request(app).put(url(okGrant, "expiry")).set(auth).send({ days: 5 })).status).toBe(409);

    const unban = await request(app).post(`/api/telegram-users/${userId}/unban`).set(auth);
    expect(unban.body.restored).toBe(1);
    expect((await grant(okGrant)).revokedAt).toBeNull();

    const logs = await prisma.activityLog.findMany({ where: { action: { in: ["REMOVE_FROM_CHANNEL", "UPDATE_ACCESS_EXPIRY"] } } });
    expect(logs.length).toBeGreaterThanOrEqual(4);
  });

  it("body'siz cheklash (eski klient) ham ishlaydi", async () => {
    const res = await request(app).post(`/api/telegram-users/${userId}/ban`).set(auth);
    expect(res.status).toBe(200);
    await request(app).post(`/api/telegram-users/${userId}/unban`).set(auth);
  });
});
