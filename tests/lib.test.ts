import { describe, expect, it } from "vitest";
import { parseStartPayload } from "../src/lib/deeplink";
import { normalizePhone } from "../src/lib/phone";
import { formatSum, formatShortDateTime, isWorkingTime, maskCard, formatPhone } from "../src/lib/format";
import { canTransition, TRANSITIONS } from "../src/services/orders";
import { fill } from "../src/services/texts";

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
