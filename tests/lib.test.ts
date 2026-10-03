import { describe, expect, it } from "vitest";
import { Api, InlineKeyboard, Keyboard } from "grammy";
import { EMPTY_TEXT_PLACEHOLDER, installEmptyTextGuard } from "../src/bot/emptyText";
import { parseStartPayload } from "../src/lib/deeplink";
import { normalizePhone } from "../src/lib/phone";
import { formatSum, formatShortDateTime, isWorkingTime, maskCard, formatPhone } from "../src/lib/format";
import { canTransition, TRANSITIONS } from "../src/services/orders";
import { fill } from "../src/services/texts";
import { normalizeTelegramUsername } from "../src/lib/telegramUsername";
import { formatCourseName } from "../src/lib/format";
import { telegramHtmlError } from "../src/lib/telegramHtml";
import { editableTextError } from "../src/services/texts";
import { uz as uzTexts } from "../src/i18n/locales/uz";
import { EDITABLE_TEXT_KEYS } from "../src/i18n/catalog";
import { exportPart, summaryLines, type ExportRow, type ExportSource } from "../src/services/export/rows";
import { exportFileName } from "../src/services/export";

describe("deep link (TZ 5.1)", () => {
  it("mahsulot va manbani ajratadi", () => {
    expect(parseStartPayload("4b_reel12")).toEqual({ productCode: "4b", source: "reel12" });
    expect(parseStartPayload("qd_bio")).toEqual({ productCode: "qd", source: "bio" });
  });
  it("manba ichidagi _ saqlanadi", () => {
    expect(parseStartPayload("4b_ig_story_5")).toEqual({ productCode: "4b", source: "ig_story_5" });
  });
  it("parametrsiz START — direct", () => {
    expect(parseStartPayload("")).toEqual({ productCode: null, source: "direct" });
    expect(parseStartPayload(undefined)).toEqual({ productCode: null, source: "direct" });
  });
  it("manbasiz kod", () => {
    expect(parseStartPayload("bundle")).toEqual({ productCode: "bundle", source: "unknown" });
  });
  it("ruxsat etilmagan belgilar yoki 64 dan uzun — direct", () => {
    expect(parseStartPayload("4b reel")).toEqual({ productCode: null, source: "direct" });
    expect(parseStartPayload("a".repeat(65)).productCode).toBeNull();
  });
});

describe("telefon (TZ 5.2)", () => {
  it("+998 formatiga keltiradi", () => {
    expect(normalizePhone("998901234567")).toEqual({ phone: "+998901234567", isForeign: false });
    expect(normalizePhone("+998 90 123-45-67")).toEqual({ phone: "+998901234567", isForeign: false });
    expect(normalizePhone("901234567")).toEqual({ phone: "+998901234567", isForeign: false });
  });
  it("chet el raqami xorijiy deb belgilanadi", () => {
    expect(normalizePhone("79161234567")).toEqual({ phone: "+79161234567", isForeign: true });
  });
  it("chiroyli ko'rinish", () => {
    expect(formatPhone("+998901234567")).toBe("+998 90 123 45 67");
  });
});

describe("format", () => {
  it("summa: 1 250 000 so'm", () => {
    expect(formatSum(1250000)).toBe("1 250 000 so'm");
    expect(formatSum(999)).toBe("999 so'm");
  });
  it("Toshkent vaqti UTC+5", () => {
    expect(formatShortDateTime(new Date("2026-09-23T09:02:00Z"))).toBe("23.09 14:02");
  });
  it("karta niqobi", () => {
    expect(maskCard("8600123412341234")).toBe("8600 **** **** 1234");
  });
  it("ish vaqti 09:00–22:00 (BR-14)", () => {
    expect(isWorkingTime(new Date("2026-09-23T04:00:00Z"), "09:00", "22:00")).toBe(true); // 09:00
    expect(isWorkingTime(new Date("2026-09-23T03:59:00Z"), "09:00", "22:00")).toBe(false); // 08:59
    expect(isWorkingTime(new Date("2026-09-23T17:00:00Z"), "09:00", "22:00")).toBe(false); // 22:00
  });
});

describe("status o'tishlari (TZ 8.1)", () => {
  it("jadvaldagi o'tishlar", () => {
    expect(canTransition("new", "receipt_sent")).toBe(true);
    expect(canTransition("receipt_sent", "approved")).toBe(true);
    expect(canTransition("rejected", "receipt_sent")).toBe(true);
    expect(canTransition("approved", "joined")).toBe(true);
    expect(canTransition("joined", "refunded")).toBe(true);
  });
  it("jadvalda yo'q o'tishlar taqiqlangan", () => {
    expect(canTransition("new", "approved")).toBe(false);
    expect(canTransition("approved", "rejected")).toBe(false);
    expect(canTransition("expired", "receipt_sent")).toBe(false);
    expect(TRANSITIONS.refunded).toHaveLength(0);
  });
});

describe("matn shablonlari", () => {
  it("qiymatlar HTML-escape qilinadi, raw — yo'q", () => {
    expect(fill("{a} {b}", { a: "<x>" }, { b: "<b>ok</b>" })).toBe("&lt;x&gt; <b>ok</b>");
    expect(fill("{yoq}")).toBe("{yoq}");
  });
});

describe("support username normalizatsiyasi", () => {
  it("@, havola va oddiy yozuv bir xil username beradi", () => {
    for (const raw of ["support", "@support", " @support ", "https://t.me/support", "http://telegram.me/support", "t.me/support"]) {
      expect(normalizeTelegramUsername(raw)).toBe("support");
    }
    expect(normalizeTelegramUsername("@support_123")).toBe("support_123");
    expect(normalizeTelegramUsername("new_support")).toBe("new_support");
  });
  it("yaroqsiz qiymatlar rad etiladi", () => {
    for (const raw of ["", "@", "@new support", "abc", "1support", "support_", "sup__port", "https://t.me/support/1", "t.me/+invite", "<b>x</b>", "a".repeat(33)]) {
      expect(normalizeTelegramUsername(raw)).toBeNull();
    }
  });
});

describe("kurs nomini ko'rsatish", () => {
  it("limitgacha qisqartiradi, qisqa nom to'liq qoladi", () => {
    expect(formatCourseName("Node js kursi", 7)).toBe("Node js");
    expect(formatCourseName("Node js kursi", 8)).toBe("Node js"); // oxiridagi bo'shliq olib tashlanadi
    expect(formatCourseName("Node js kursi", 10)).toBe("Node js ku");
    expect(formatCourseName("Node js kursi", 100)).toBe("Node js kursi");
    expect(formatCourseName("🚀🚀🚀 Kurs", 2)).toBe("🚀🚀"); // emoji bo'linmaydi
  });
});

describe("tahrirlanadigan bot matnlari", () => {
  it("standart matnlar yaroqli", () => {
    for (const key of ["intro_video_text", "payment_step_1", "payment_step_2", "payment_expires"] as const) {
      expect(editableTextError(key, uzTexts[key])).toBeNull();
    }
  });
  it("bo'sh matn (xabar o'chiriladi) va {expires_at} siz matn ruxsat etilgan", () => {
    expect(editableTextError("payment_step_1", "  ")).toBeNull();
    expect(editableTextError("payment_expires", "")).toBeNull();
    expect(editableTextError("payment_expires", "⏳ Buyurtma 06.10.2026 06:41 gacha amal qiladi.")).toBeNull();
  });
  it("noma'lum o'zgaruvchi va buzuq HTML rad etiladi", () => {
    expect(editableTextError("payment_step_1", "{nimadir} ga o'tkazing")).toMatch(/Noma'lum/);
    expect(editableTextError("intro_video_text", "a".repeat(801))).toMatch(/800/);
    expect(telegramHtmlError("<b>qalin")).toMatch(/yopilmagan/);
    expect(telegramHtmlError("<b>x</i>")).toMatch(/noto'g'ri/);
    expect(telegramHtmlError("1 < 2")).toMatch(/&lt;/);
    expect(telegramHtmlError("<div>x</div>")).toMatch(/qo'llab-quvvatlanmaydi/);
    expect(telegramHtmlError('<b>ok</b> &amp; <a href="https://t.me/x">link</a> 🎉')).toBeNull();
  });
});

describe("bot matnlari katalogi", () => {
  it("tugma yozuvlaridan tashqari barcha matnlar admin panelda tahrirlanadi", () => {
    const isLabel = (k: string) => /^(btn_|menu_|adm_btn_|role_)/.test(k) || ["phone_button", "loading", "not_set"].includes(k);
    const missing = Object.keys(uzTexts).filter((k) => !isLabel(k) && !(EDITABLE_TEXT_KEYS as string[]).includes(k));
    expect(missing).toEqual([]);
    expect(EDITABLE_TEXT_KEYS.filter(isLabel)).toEqual([]);
    expect(new Set(EDITABLE_TEXT_KEYS).size).toBe(EDITABLE_TEXT_KEYS.length);
  });
  it("barcha standart matnlar o'z qoidalariga mos", () => {
    for (const key of EDITABLE_TEXT_KEYS) expect([key, editableTextError(key, uzTexts[key])]).toEqual([key, null]);
  });
});

describe("bo'sh matn himoyasi (paneldan o'chirilgan xabarlar)", () => {
  const setup = () => {
    const calls: { method: string; payload: Record<string, unknown> }[] = [];
    const api = new Api("1:test");
    // Eng ichki transformer — tarmoq o'rniga chaqiruvni yozib oladi
    api.config.use((_prev, method, payload) => {
      calls.push({ method, payload: payload as Record<string, unknown> });
      return Promise.resolve({ ok: true, result: method === "sendMessage" ? { message_id: 5, chat: { id: 1 } } : true } as never);
    });
    installEmptyTextGuard(api);
    return { api, calls };
  };

  it("tugmasiz bo'sh xabar yuborilmaydi, oddiy xabar o'zgarmaydi", async () => {
    const { api, calls } = setup();
    expect((await api.sendMessage(1, "")).message_id).toBe(0);
    expect((await api.sendMessage(1, "<b> </b>", { parse_mode: "HTML" })).message_id).toBe(0);
    expect(await api.editMessageText(1, 7, "")).toBe(true);
    expect(calls).toEqual([]);
    expect((await api.sendMessage(1, "Salom")).message_id).toBe(5);
    expect(calls[0].payload.text).toBe("Salom");
  });

  it("tugmali bo'sh xabar 👇 bilan yuboriladi; bo'sh popup matnsiz javob beradi", async () => {
    const { api, calls } = setup();
    await api.sendMessage(1, "", { reply_markup: new InlineKeyboard().text("Kurs", "p:1") });
    await api.sendMessage(1, "", { reply_markup: new Keyboard().text("Menyu").resized() });
    await api.editMessageText(1, 7, "", { reply_markup: new InlineKeyboard().text("Orqaga", "nav:home") });
    expect(calls.map((c) => c.payload.text)).toEqual([EMPTY_TEXT_PLACEHOLDER, EMPTY_TEXT_PLACEHOLDER, EMPTY_TEXT_PLACEHOLDER]);
    // Tugmasi yo'q bo'sh klaviatura — xabar yuborilmaydi
    await api.sendMessage(1, "", { reply_markup: new InlineKeyboard() });
    expect(calls).toHaveLength(3);
    await api.answerCallbackQuery("q1", { text: "", show_alert: true });
    expect(calls[3]).toMatchObject({ method: "answerCallbackQuery" });
    expect(calls[3].payload).not.toHaveProperty("text");
    expect(calls[3].payload).not.toHaveProperty("show_alert");
  });
});

describe("eksportni qismlarga bo'lish", () => {
  const source = (total: number, batch: number): ExportSource => ({
    summary: { generatedAt: new Date("2026-10-01T10:30:00Z"), total, buyers: 0, paidOrders: 0, revenue: 0, filters: [] },
    async *batches() {
      for (let i = 0; i < total; i += batch) yield Array.from({ length: Math.min(batch, total - i) }, (_, j) => ({ id: String(i + j + 1) }) as ExportRow);
    },
  });
  const ids = async (s: ExportSource) => {
    const out: number[] = [];
    for await (const rows of s.batches()) out.push(...rows.map((r) => Number(r.id)));
    return out;
  };

  it("ikki qism butun ro'yxatni takrorsiz va tushirib qoldirmasdan qoplaydi", async () => {
    for (const [total, batch] of [[10, 3], [11, 4], [1, 5], [7, 7], [1000, 500]] as const) {
      const [a, b] = [await ids(exportPart(source(total, batch), 1, 2)), await ids(exportPart(source(total, batch), 2, 2))];
      expect([...a, ...b]).toEqual(Array.from({ length: total }, (_, i) => i + 1));
      expect(a.length).toBe(Math.ceil(total / 2));
    }
    expect(await ids(exportPart(source(0, 5), 2, 2))).toEqual([]);
  });

  it("sarlavhada qism va qatorlar oralig'i, fayl nomida qism raqami", () => {
    const part = exportPart(source(11, 4), 2, 2);
    expect(part.summary.total).toBe(11);
    expect(summaryLines(part.summary)).toContainEqual(["Qism", "2 / 2 (7–11-qatorlar)"]);
    expect(summaryLines(source(11, 4).summary).some(([k]) => k === "Qism")).toBe(false);
    expect(exportFileName("pdf", new Date("2026-10-01T10:30:00Z"), 2)).toBe("users-2026-10-01-1530-2qism.pdf");
    expect(exportFileName("pdf", new Date("2026-10-01T10:30:00Z"))).toBe("users-2026-10-01-1530.pdf");
  });
});
