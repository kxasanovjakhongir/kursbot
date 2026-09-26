import { describe, expect, it, vi } from "vitest";
import { GrammyError } from "grammy";
import { Prisma } from "@prisma/client";
import { allLabels, guessLang, label, LANGS, LOCALES } from "../src/i18n";
import { can, PERMISSIONS, roleOf } from "../src/services/permissions";
import { TtlMap } from "../src/lib/ttlMap";
import { paginate } from "../src/bot/ui/render";
import { classifyError } from "../src/bot/middleware/errorBoundary";
import { formatDate, stripHtml, truncate } from "../src/lib/format";
import { InitDataError, signInitData, verifyInitData } from "../src/lib/telegramAuth";
import { safeFileName, sniffFileType } from "../src/lib/fileType";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("i18n", () => {
  it("har bir tilda barcha kalitlar bor va {o'zgaruvchilar} bir xil", () => {
    for (const lang of LANGS) {
      for (const key of Object.keys(LOCALES.uz) as (keyof typeof LOCALES.uz)[]) {
        const value = LOCALES[lang][key];
        expect(value, `${lang}.${key}`).toBeTruthy();
        expect(placeholders(value), `${lang}.${key}`).toEqual(placeholders(LOCALES.uz[key]));
      }
    }
  });

  it("HTML teglari muvozanatda (Telegram parse_mode=HTML xato bermasligi uchun)", () => {
    for (const lang of LANGS) {
      for (const [key, value] of Object.entries(LOCALES[lang])) {
        for (const tag of ["b", "i", "code", "s"]) {
          const open = value.split(`<${tag}>`).length - 1;
          const close = value.split(`</${tag}>`).length - 1;
          expect(open, `${lang}.${key} <${tag}>`).toBe(close);
        }
      }
    }
  });

  it("tugma yozuvlari: barcha tillardagi variantlar, o'zgaruvchi to'ldiriladi", () => {
    expect(allLabels("menu_products")).toEqual(["📚 Darsliklar", "📚 Учебники", "📚 Textbooks"]);
    expect(label("en", "btn_get_link", { mahsulot: "4B" })).toBe("🔗 4B");
  });

  it("Telegram tilidan taxmin", () => {
    expect(guessLang("ru-RU")).toBe("ru");
    expect(guessLang("de")).toBe("uz");
    expect(guessLang(undefined)).toBe("uz");
  });
});

describe("rollar va ruxsatlar", () => {
  it("USER faqat mijoz bo'limlarini ko'radi", () => {
    expect(can("user", "profile.view")).toBe(true);
    expect(can("user", "orders.review")).toBe(false);
    expect(can(null, "stats.view")).toBe(false);
  });

  it("ADMIN — kontent, foydalanuvchilar, cheklar; tizim sozlamalari yo'q", () => {
    for (const p of ["orders.review", "stats.view", "users.manage", "broadcast.send", "content.manage"] as const) expect(can("admin", p)).toBe(true);
    for (const p of ["products.manage", "cards.manage", "admins.manage", "settings.manage", "logs.view"] as const) expect(can("admin", p)).toBe(false);
  });

  it("SUPER_ADMIN — hammasi", () => {
    for (const p of PERMISSIONS) expect(can("superadmin", p)).toBe(true);
  });

  it("roleOf: admin yozuvi bo'lmasa — user", () => {
    expect(roleOf(null)).toBe("user");
    expect(roleOf({ role: "superadmin" })).toBe("superadmin");
  });
});

describe("TtlMap", () => {
  it("muddati o'tgan qiymat o'chadi, take bir martalik", () => {
    vi.useFakeTimers();
    const m = new TtlMap<string, number>(1000);
    m.set("a", 1);
    expect(m.get("a")).toBe(1);
    expect(m.take("a")).toBe(1);
    expect(m.get("a")).toBeUndefined();
    m.set("b", 2);
    vi.advanceTimersByTime(1001);
    expect(m.has("b")).toBe(false);
    vi.useRealTimers();
  });

  it("hajm chegarasidan oshsa eng eskilari o'chiriladi (xotira o'smaydi)", () => {
    const m = new TtlMap<number, number>(60_000, 3);
    for (let i = 0; i < 10; i++) m.set(i, i);
    expect(m.size).toBe(3);
    expect(m.get(9)).toBe(9);
    expect(m.get(0)).toBeUndefined();
  });
});

describe("pagination", () => {
  it("sahifa chegaradan chiqsa — eng yaqin mavjud sahifa", () => {
    const items = Array.from({ length: 13 }, (_, i) => i);
    expect(paginate(items, 2, 5)).toMatchObject({ items: [5, 6, 7, 8, 9], page: 2, pages: 3, total: 13 });
    expect(paginate(items, 99, 5).page).toBe(3);
    expect(paginate(items, 0, 5).page).toBe(1);
    expect(paginate([], 1, 5)).toMatchObject({ items: [], page: 1, pages: 1 });
  });
});

describe("xatolarni turkumlash", () => {
  const grammy = (code: number, description: string) =>
    new GrammyError("x", { ok: false, error_code: code, description }, "sendMessage", {});

  it("zararsiz, bloklagan, baza va umumiy xatolar ajratiladi", () => {
    expect(classifyError(grammy(400, "Bad Request: message is not modified"))).toBe("ignore");
    expect(classifyError(grammy(400, "Bad Request: query is too old"))).toBe("ignore");
    expect(classifyError(grammy(403, "Forbidden: bot was blocked by the user"))).toBe("blocked");
    expect(classifyError(new Prisma.PrismaClientKnownRequestError("x", { code: "P1001", clientVersion: "6" }))).toBe("database");
    expect(classifyError(new Error("boom"))).toBe("generic");
  });
});

describe("format yordamchilari", () => {
  it("sana, HTML tozalash, qisqartirish", () => {
    expect(formatDate(new Date("2026-09-23T20:00:00Z"))).toBe("24.09.2026");
    expect(stripHtml("<b>Salom</b> &lt;do'st&gt;")).toBe("Salom <do'st>");
    expect(truncate("abcdefgh", 5)).toBe("abcd…");
    expect(truncate("abc", 5)).toBe("abc");
  });
});

describe("Telegram Mini App initData", () => {
  const token = "123:abc";
  const now = Date.UTC(2026, 8, 24, 12, 0, 0);
  const authDate = String(Math.floor(now / 1000) - 60);
  const user = JSON.stringify({ id: 42, first_name: "Aziz", username: "aziz", photo_url: "https://t.me/i/userpic/1.jpg" });

  it("to'g'ri imzo qabul qilinadi, maydonlar o'qiladi", () => {
    const data = signInitData({ auth_date: authDate, user, start_param: "4b" }, token);
    const v = verifyInitData(data, token, 3600, now);
    expect(v.user).toMatchObject({ id: 42, first_name: "Aziz" });
    expect(v.startParam).toBe("4b");
  });

  it("boshqa token, o'zgartirilgan maydon, eskirgan va buzuq ma'lumot rad etiladi", () => {
    const data = signInitData({ auth_date: authDate, user }, token);
    expect(() => verifyInitData(data, "123:other", 3600, now)).toThrow(InitDataError);
    expect(() => verifyInitData(data.replace("Aziz", "Vali"), token, 3600, now)).toThrow(InitDataError);
    expect(() => verifyInitData(data, token, 30, now)).toThrow(/eskirgan/);
    expect(() => verifyInitData("user=x", token, 3600, now)).toThrow(InitDataError);
    const badUser = signInitData({ auth_date: authDate, user: JSON.stringify({ id: "42", first_name: 1 }) }, token);
    expect(() => verifyInitData(badUser, token, 3600, now)).toThrow(/user/);
  });
});

describe("fayl turi va nomi (upload xavfsizligi)", () => {
  it("magic bytes bo'yicha aniqlanadi, kengaytma/Content-Type ga ishonilmaydi", () => {
    const pad = (hex: string) => Buffer.concat([Buffer.from(hex, "hex"), Buffer.alloc(16)]);
    expect(sniffFileType(pad("ffd8ffe0"))).toBe("jpeg");
    expect(sniffFileType(pad("89504e470d0a1a0a"))).toBe("png");
    expect(sniffFileType(Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj"))).toBe("pdf");
    expect(sniffFileType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]))).toBe("webp");
    expect(sniffFileType(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom"), Buffer.alloc(8)]))).toBe("mp4");
    expect(sniffFileType(Buffer.from("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffFileType(Buffer.from("MZ\x90\x00 exe fayl......"))).toBeNull();
    expect(sniffFileType(Buffer.alloc(3))).toBeNull();
  });

  it("fayl nomi: yo'l qismlari va xavfli belgilar olib tashlanadi", () => {
    expect(safeFileName("../../etc/passwd", "f")).toBe("passwd");
    expect(safeFileName("C:\\Windows\\evil.exe", "f")).toBe("evil.exe");
    expect(safeFileName("chek <script>.png", "f")).toBe("chek _script_.png");
    expect(safeFileName("...hidden", "f")).toBe("hidden");
    expect(safeFileName("", "receipt.jpg")).toBe("receipt.jpg");
    expect(safeFileName(undefined, "receipt.jpg")).toBe("receipt.jpg");
    expect(safeFileName("a".repeat(300), "f")).toHaveLength(80);
    expect(safeFileName("Chek_to'lov №5.pdf", "f")).toBe("Chek_to_lov No5.pdf");
  });
});
