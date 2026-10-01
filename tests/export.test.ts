import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Writable } from "node:stream";
import type { Api } from "grammy";
import type { Express } from "express";
import { prisma } from "../src/db";
import { createApp } from "../src/api/app";
import { createPanelUser } from "../src/services/panelUsers";
import { signAppToken } from "../src/api/webapp/session";
import { can } from "../src/services/permissions";
import { prepareUserExport } from "../src/services/export";
import { userExportSource } from "../src/services/export/rows";

const enabled = !!process.env.TEST_DATABASE_URL;

const fakeApi = { token: "test", getMe: async () => ({ id: 42, is_bot: true, first_name: "Bot", username: "test_bot" }) } as unknown as Api;

/** Javobni Buffer sifatida yig'ish (supertest binar javob uchun) */
const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};

describe("ruxsatlar matritsasi", () => {
  it("export va dars boshqaruvi — faqat adminlar", () => {
    expect(can("user", "users.export")).toBe(false);
    expect(can("user", "lessons.manage")).toBe(false);
    expect(can("admin", "users.export")).toBe(true);
    expect(can("superadmin", "lessons.manage")).toBe(true);
  });
});

describe.skipIf(!enabled)("foydalanuvchilar eksporti va darslar API", () => {
  let app: Express;
  let token = "";
  let productId = 0;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE activity_logs, panel_users, notifications, events, messages, receipts, access_grants, orders, cards, products, admins, users RESTART IDENTITY CASCADE`,
    );
    await createPanelUser({ email: "admin@test.uz", name: "Admin", password: "adminpass1", role: "admin" });
    const [js, py] = await Promise.all([
      prisma.product.create({ data: { code: "js", title: "JavaScript", price: 500_000, channelId: -1001n } }),
      prisma.product.create({ data: { code: "py", title: "Python", price: 400_000, channelId: -1002n } }),
    ]);
    productId = js.id;
    // Kirill, o'zbekcha belgilar va XML ni buzadigan belgilar — fayllar buzilmasligi kerak
    const ali = await prisma.user.create({ data: { telegramId: 1001n, firstName: "Ali <b>&", lastName: "Valiyev", username: "ali", phone: "+998901234567" } });
    const vali = await prisma.user.create({ data: { telegramId: 1002n, firstName: "Вали\u0007", isBlocked: true } });
    await prisma.user.create({ data: { telegramId: 1003n, firstName: "Gʻani", createdAt: new Date("2025-01-01T00:00:00Z") } });
    await prisma.order.createMany({
      data: [
        { userId: ali.id, productId: js.id, amount: 500_000, status: "approved", paidAt: new Date(), expiresAt: new Date() },
        { userId: ali.id, productId: py.id, amount: 400_000, status: "joined", paidAt: new Date(), expiresAt: new Date() },
        { userId: vali.id, productId: py.id, amount: 400_000, status: "receipt_sent", expiresAt: new Date() },
      ],
    });
    app = createApp({ runtime: { api: fakeApi, mode: "polling", tokenSource: "env", isRunning: () => true } });
    token = (await request(app).post("/api/auth/login").send({ email: "admin@test.uz", password: "adminpass1" })).body.token;
  });
  afterAll(() => prisma.$disconnect());

  const get = (path: string) => request(app).get(path).set("Authorization", `Bearer ${token}`).buffer(true).parse(binary);

  it("TEST 7: Excel (.xlsx) yuklanadi", async () => {
    const res = await get("/api/telegram-users/export/xlsx");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml.sheet");
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="users-\d{4}-\d{2}-\d{2}-\d{4}\.xlsx"/);
    expect(res.headers["x-export-total"]).toBe("3");
    expect((res.body as Buffer).subarray(0, 2).toString()).toBe("PK"); // zip (OOXML)
  });

  it("TEST 8: Word (.docx) yuklanadi; /export/word nomi ham ishlaydi", async () => {
    const res = await get("/api/telegram-users/export/word");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("wordprocessingml.document");
    expect((res.body as Buffer).subarray(0, 2).toString()).toBe("PK");
  });

  it("TEST 9: PDF yuklanadi", async () => {
    const res = await get("/api/telegram-users/export/pdf");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    const body = res.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(body.subarray(-6).toString()).toContain("%%EOF");
  });

  it("TEST 10: tokensiz, Mini App (oddiy foydalanuvchi) tokeni bilan — 401; noma'lum format — 400", async () => {
    expect((await request(app).get("/api/telegram-users/export/xlsx")).status).toBe(401);
    const user = await prisma.user.findFirstOrThrow();
    const appToken = signAppToken(user);
    expect((await request(app).get("/api/telegram-users/export/xlsx").set("Authorization", `Bearer ${appToken}`)).status).toBe(401);
    expect((await request(app).get("/api/lessons").set("Authorization", `Bearer ${appToken}`)).status).toBe(401);
    expect((await get("/api/telegram-users/export/csv")).status).toBe(400);
    // Mini App API da export yo'q
    expect((await request(app).get("/api/app/telegram-users/export/xlsx").set("Authorization", `Bearer ${appToken}`)).status).toBe(404);
  });

  it("filtrlar: export ro'yxat bilan aynan bir xil natija beradi", async () => {
    const cases: [string, Record<string, string>, number][] = [
      ["barchasi", {}, 3],
      ["sotib olganlar", { purchased: "yes" }, 1],
      ["sotib olmaganlar", { purchased: "no" }, 2],
      ["konkret kurs", { boughtProductId: String(productId) }, 1],
      ["to'lov holati", { paymentStatus: "receipt_sent" }, 1],
      ["sana oralig'i", { from: "2026-01-01T00:00:00.000Z" }, 2],
    ];
    for (const [name, params, expected] of cases) {
      const qs = new URLSearchParams(params).toString();
      const list = await request(app).get(`/api/telegram-users?${qs}`).set("Authorization", `Bearer ${token}`);
      const filter = {
        status: "all" as const,
        purchased: params.purchased ? params.purchased === "yes" : undefined,
        boughtProductId: params.boughtProductId ? Number(params.boughtProductId) : undefined,
        paymentStatus: params.paymentStatus as "receipt_sent" | undefined,
        from: params.from ? new Date(params.from) : undefined,
      };
      const { summary } = await prepareUserExport("xlsx", filter);
      expect([name, list.body.total, summary.total]).toEqual([name, expected, expected]);
    }
  });

  it("validatsiya, SQL injection va rate limit (daqiqasiga 10 ta export)", async () => {
    // Yangi app — limiter hisobi toza
    app = createApp({ runtime: { api: fakeApi, mode: "polling", tokenSource: "env", isRunning: () => true } });
    expect((await get("/api/telegram-users/export/xlsx?paymentStatus=hacked")).status).toBe(400);
    const inj = await get(`/api/telegram-users/export/xlsx?q=${encodeURIComponent("' OR 1=1; DROP TABLE users; --")}`);
    expect(inj.status).toBe(200);
    expect(inj.headers["x-export-total"]).toBe("0");
    expect(await prisma.user.count()).toBe(3);
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await get("/api/telegram-users/export/xlsx")).status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    app = createApp({ runtime: { api: fakeApi, mode: "polling", tokenSource: "env", isRunning: () => true } });
  });

  it("qator ma'lumotlari: kurslar, summa, to'lov holati, status — bazadagidek", async () => {
    const src = await userExportSource({ status: "all" }, 2);
    const rows = [];
    for await (const b of src.batches()) {
      expect(b.length).toBeLessThanOrEqual(2); // bo'laklab o'qiladi
      rows.push(...b);
    }
    expect(rows).toHaveLength(3);
    const ali = rows.find((r) => r.telegramId === "1001")!;
    expect(ali).toMatchObject({ courses: "JavaScript; Python", purchaseCount: 2, totalPaid: 900_000, paymentStatus: "To'langan (kanalda)", accountStatus: "Faol", phone: "+998901234567" });
    expect(rows.find((r) => r.telegramId === "1002")).toMatchObject({ purchaseCount: 0, paymentStatus: "Chek tekshirilmoqda", accountStatus: "Botni bloklagan" });
    expect(src.summary).toMatchObject({ total: 3, buyers: 1, paidOrders: 2, revenue: 900_000 });
  });

  it("katta baza (20 000): fayl oqim bilan yoziladi, xotira keskin o'smaydi", async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO users (telegram_id, first_name, username, phone, created_at, last_seen_at)
       SELECT 2000000 + g, 'User ' || g, 'user' || g, '+99890' || lpad(g::text, 7, '0'), now(), now() FROM generate_series(1, 20000) g`,
    );
    for (const format of ["xlsx", "docx", "pdf"] as const) {
      const { summary, write } = await prepareUserExport(format, { status: "all" });
      expect(summary.total).toBe(20_003);
      let bytes = 0;
      const sink = new Writable({
        write(chunk: Buffer, _enc, cb) {
          bytes += chunk.length;
          cb();
        },
      });
      const before = process.memoryUsage().heapUsed;
      let peak = before;
      const probe = setInterval(() => (peak = Math.max(peak, process.memoryUsage().heapUsed)), 5);
      await write(sink);
      clearInterval(probe);
      expect(bytes).toBeGreaterThan(100_000);
      // Oqim + bo'laklar: 20 000 qatorda ham heap o'sishi (axlat bilan birga) cheklangan
      expect([format, peak - before < 150 * 1024 * 1024]).toEqual([format, true]);
    }
    await prisma.$executeRawUnsafe(`DELETE FROM users WHERE telegram_id > 2000000`);
  }, 120_000);

  // ---------- Darslar API ----------

  it("darslar: ro'yxat (file_id chiqmaydi), tahrirlash, tartib, o'chirish; noto'g'ri tartib — 400", async () => {
    const [a, b] = await Promise.all(
      ["A", "B"].map((t, i) =>
        prisma.lesson.create({ data: { productId, title: t, telegramFileId: `secret-file-${t}`, telegramFileUniqueId: `u${t}`, sortOrder: i + 1, fileSize: 3_000_000_000n } }),
      ),
    );
    const auth = { Authorization: `Bearer ${token}` };
    const list = await request(app).get(`/api/lessons?productId=${productId}`).set(auth);
    expect(list.status).toBe(200);
    expect(list.body.items.map((l: { title: string }) => l.title)).toEqual(["A", "B"]);
    expect(list.body.items[0].fileSize).toBe("3000000000");
    expect(JSON.stringify(list.body)).not.toContain("secret-file");

    expect((await request(app).put(`/api/lessons/${a.id}`).set(auth).send({ title: "Kirish", caption: "" })).status).toBe(200);
    expect(await prisma.lesson.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ title: "Kirish", caption: null });
    expect((await request(app).put(`/api/lessons/${a.id}`).set(auth).send({ title: "" })).status).toBe(400);
    expect((await request(app).put(`/api/lessons/${a.id}`).set(auth).send({ productId: 999 })).status).toBe(400);

    expect((await request(app).post("/api/lessons/reorder").set(auth).send({ productId, ids: [b.id, a.id] })).status).toBe(200);
    expect((await prisma.lesson.findMany({ orderBy: { sortOrder: "asc" } })).map((l) => l.id)).toEqual([b.id, a.id]);
    // Boshqa kursning darsi yoki to'liq bo'lmagan ro'yxat — rad etiladi
    expect((await request(app).post("/api/lessons/reorder").set(auth).send({ productId, ids: [a.id] })).status).toBe(400);

    expect((await request(app).delete(`/api/lessons/${a.id}`).set(auth)).status).toBe(200);
    expect((await request(app).delete(`/api/lessons/${a.id}`).set(auth)).status).toBe(404);
    expect((await request(app).get("/api/lessons")).status).toBe(401);
  });
});
