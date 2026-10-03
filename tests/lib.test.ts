import { describe, expect, it } from "vitest";
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
  it("bo'sh, {expires_at} siz, noma'lum o'zgaruvchi va buzuq HTML rad etiladi", () => {
    expect(editableTextError("payment_step_1", "  ")).toMatch(/bo'sh/);
    expect(editableTextError("payment_expires", "⏳ Buyurtma 06.10.2026 06:41 gacha amal qiladi.")).toMatch(/\{expires_at\}/);
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
