import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Api } from "grammy";
import { prisma } from "../src/db";
import { addCard } from "../src/services/cards";
import { approveOrder, attachReceipt, createOrder, expireStaleOrders, rejectOrder } from "../src/services/orders";
import { decideJoinRequest, grantAccess } from "../src/services/access";
import { checkOwnership } from "../src/services/products";

const enabled = !!process.env.TEST_DATABASE_URL;

// Telegram API ning soxta varianti — faqat invite link yaratish kerak
let linkSeq = 0;
const fakeApi = {
  createChatInviteLink: async () => ({ invite_link: `https://t.me/+test${++linkSeq}` }),
  revokeChatInviteLink: async () => ({}),
} as unknown as Api;

async function reset() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE broadcast_recipients, broadcasts, events, audit_log, messages, reminders, access_grants, receipts, orders, promo_codes, cards, products, admins, settings, texts, users RESTART IDENTITY CASCADE`,
  );
  await prisma.product.createMany({
    data: [
      { code: "4b", title: "4 bosqichli", price: 1_250_000, channelId: -1001n },
      { code: "qd", title: "Qoidalar", price: 800_000, channelId: -1002n },
      { code: "bundle", title: "To'plam", price: 1_700_000, type: "bundle", bundleCodes: ["4b", "qd"] },
    ],
  });
  await addCard("8600123412341234", "A. Karimov");
  await prisma.admin.createMany({ data: [{ telegramId: 1n, name: "Admin1" }, { telegramId: 2n, name: "Admin2" }] });
  await prisma.user.createMany({ data: [{ telegramId: 100n, firstName: "Aziz", phone: "+998901234567" }, { telegramId: 200n, firstName: "Begona" }] });
}

const product = (code: string) => prisma.product.findUniqueOrThrow({ where: { code } });
const user = (tg: bigint) => prisma.user.findUniqueOrThrow({ where: { telegramId: tg } });
const file = (u: string) => ({ fileId: `f-${u}`, fileUniqueId: u, fileType: "photo" as const });

describe.skipIf(!enabled)("servis qatlami (integratsion)", () => {
  beforeEach(reset);
  afterAll(() => prisma.$disconnect());

  it("T-04 / BR-01: 'Olaman' ikki marta — bitta buyurtma", async () => {
    const u = await user(100n);
    const p = await product("4b");
    const [a, b] = await Promise.all([createOrder(u.id, p, "reel12"), createOrder(u.id, p, "reel12")]);
    const ids = [a, b].map((r) => ("order" in r ? r.order.id : null));
    expect(ids[0]).toBe(ids[1]);
    expect(await prisma.order.count()).toBe(1);
  });

  it("T-15 / BR-03: narx buyurtmada qotiriladi", async () => {
    const u = await user(100n);
    const r = await createOrder(u.id, await product("4b"), null);
    await prisma.product.update({ where: { code: "4b" }, data: { price: 2_000_000 } });
    const again = await createOrder(u.id, await product("4b"), null);
    expect(r.kind).toBe("created");
    expect(again.kind).toBe("existing");
    expect("order" in again && again.order.amount).toBe(1_250_000);
  });

  it("T-11 / BR-04: 4-urinish qabul qilinmaydi", async () => {
    const u = await user(100n);
    const r = await createOrder(u.id, await product("4b"), null);
    if (r.kind !== "created") throw new Error();
    for (let i = 1; i <= 3; i++) {
      expect((await attachReceipt(r.order.id, file(`u${i}`))).kind).toBe("ok");
      expect(await rejectOrder(r.order.id, 1, "Chek o'qilmaydi", null)).toBe(true);
    }
    expect((await attachReceipt(r.order.id, file("u4"))).kind).toBe("max_attempts");
  });

  it("T-17: dublikat chek belgilanadi", async () => {
    const u = await user(100n);
    const r1 = await createOrder(u.id, await product("4b"), null);
    const r2 = await createOrder(u.id, await product("qd"), null);
    if (r1.kind !== "created" || r2.kind !== "created") throw new Error();
    const a = await attachReceipt(r1.order.id, file("same"));
    const b = await attachReceipt(r2.order.id, file("same"));
    expect(a.kind === "ok" && a.isDuplicate).toBe(false);
    expect(b.kind === "ok" && b.isDuplicate).toBe(true);
  });

  it("T-08 / BR-12: ikki admin bir vaqtda — faqat bittasi o'tadi", async () => {
    const u = await user(100n);
    const r = await createOrder(u.id, await product("4b"), null);
    if (r.kind !== "created") throw new Error();
    await attachReceipt(r.order.id, file("x"));
    const [a, b] = await Promise.all([approveOrder(r.order.id, 1), approveOrder(r.order.id, 2)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("T-07, T-09, T-16: link, begona akkaunt rad etiladi, qayta sotib olish yo'q", async () => {
    const u = await user(100n);
    const p = await product("4b");
    const r = await createOrder(u.id, p, null);
    if (r.kind !== "created") throw new Error();
    await attachReceipt(r.order.id, file("y"));
    await approveOrder(r.order.id, 1);
    const [grant] = await grantAccess(fakeApi, r.order, u.telegramId);
    expect(grant.inviteLink).toBeTruthy();

    const foreign = await decideJoinRequest(grant.inviteLink!, 200n);
    expect(foreign).toMatchObject({ kind: "decline", reason: "foreign_user" });
    expect((await decideJoinRequest("https://t.me/+random", 200n)).kind).toBe("decline");

    const own = await decideJoinRequest(grant.inviteLink!, 100n);
    expect(own).toMatchObject({ kind: "approve", orderJoined: true });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: r.order.id } })).status).toBe("joined");

    expect((await checkOwnership(u.id, p)).kind).toBe("owned");
    // To'plamda faqat yetishmayotgan darslik qoladi
    const own2 = await checkOwnership(u.id, await product("bundle"));
    expect(own2.kind === "partial" && own2.missing.map((m) => m.code)).toEqual(["qd"]);
  });

  it("T-14 / BR-02: muddati o'tgan buyurtma expired", async () => {
    const u = await user(100n);
    const r = await createOrder(u.id, await product("4b"), null);
    if (r.kind !== "created") throw new Error();
    await prisma.order.update({ where: { id: r.order.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await attachReceipt(r.order.id, file("late"))).kind).toBe("closed");
    expect(await expireStaleOrders()).toBe(1);
    const next = await createOrder(u.id, await product("4b"), null);
    expect(next.kind).toBe("created");
  });

  it("to'plam tasdiqlansa ikkala kanalga alohida link", async () => {
    const u = await user(100n);
    const r = await createOrder(u.id, await product("bundle"), null);
    if (r.kind !== "created") throw new Error();
    await attachReceipt(r.order.id, file("b"));
    await approveOrder(r.order.id, 1);
    const grants = await grantAccess(fakeApi, r.order, u.telegramId);
    expect(grants.map((g) => g.product.code)).toEqual(["4b", "qd"]);
  });
});
