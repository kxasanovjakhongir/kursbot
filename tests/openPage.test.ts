import { describe, expect, it } from "vitest";
import vm from "node:vm";
import { openPage } from "../src/api/trackingRedirect";

/**
 * Reklama linki sahifasining skripti brauzer o'rnida (soxta document/window bilan) ishga tushiriladi.
 * Instagram/Facebook sahifani oldindan yashirin yuklaydi va bosilganda xotiradan ko'rsatadi — Telegram faqat
 * sahifa haqiqatan ko'ringanda ochilishi kerak.
 */
function simulate(initiallyVisible: boolean) {
  const html = openPage("Bot", "abc", 1, "n");
  const script = /<script[^>]*>([\s\S]*)<\/script>/.exec(html)?.[1] ?? "";
  const opened: string[] = [];
  const listeners: Record<string, ((e?: unknown) => void)[]> = {};
  const alt = { style: { display: "none" } };
  const document = {
    visibilityState: initiallyVisible ? "visible" : "hidden",
    getElementById: () => alt,
    addEventListener: (name: string, fn: () => void) => (listeners[`document:${name}`] ??= []).push(fn),
  };
  const location = {
    set href(url: string) {
      opened.push(url);
    },
  };
  const window = { addEventListener: (name: string, fn: (e?: unknown) => void) => (listeners[`window:${name}`] ??= []).push(fn) };
  vm.runInNewContext(script, { document, location, window, setTimeout: (fn: () => void) => fn() });
  const fire = (key: string, e?: unknown) => (listeners[key] ?? []).forEach((fn) => fn(e));
  const setVisible = (visible: boolean) => {
    document.visibilityState = visible ? "visible" : "hidden";
    fire("document:visibilitychange");
  };
  return { opened, alt, fire, setVisible };
}

const URL = "tg://resolve?domain=Bot&start=abc-m1";

describe("reklama linki sahifasi (Telegramni ochish)", () => {
  it("ko'rinib turgan sahifa Telegramni darhol bir marta ochadi; odam qaytganda takror ochmaydi", () => {
    const s = simulate(true);
    expect(s.opened).toEqual([URL]);
    s.setVisible(false); // Telegramga o'tdi
    s.setVisible(true); // Instagram'ga qaytdi
    expect(s.opened).toEqual([URL]);
    expect(s.alt.style.display).toBe("block"); // o'rniga zaxira havola
  });

  it("oldindan (yashirin) yuklangan sahifa ko'ringuncha hech narsa qilmaydi, ko'ringanda ochadi", () => {
    const s = simulate(false);
    expect(s.opened).toEqual([]);
    s.setVisible(true);
    expect(s.opened).toEqual([URL]);
  });

  it("xotiradan qayta ko'rsatilganda (pageshow persisted) yana ochadi", () => {
    const s = simulate(true);
    s.fire("window:pageshow", { persisted: true });
    expect(s.opened).toEqual([URL, URL]);
    s.fire("window:pageshow", { persisted: false });
    expect(s.opened).toHaveLength(2);
  });

  it("tugma yo'q; zaxira havola alohida belgi (-m9) bilan", () => {
    const html = openPage("Bot", "abc", 2, "n");
    expect(html).not.toContain("<button");
    expect(html).toContain('"https://t.me/Bot?start=abc-m2"');
    expect(html).toContain('href="https://t.me/Bot?start=abc-m9"');
  });
});
