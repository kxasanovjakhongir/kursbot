import { randomBytes } from "node:crypto";
import type { Express } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../db";
import { botUsername } from "../services/botInfo";
import { clickCheckoutUrl } from "../services/payments/click";
import { returnUrl } from "../services/payments/common";
import { parsePayRef, payProviderEnabled, type PayProvider } from "../services/payments/payLink";
import { paymeCheckoutUrl } from "../services/payments/payme";
import { userLang } from "../services/users";
import type { Lang } from "../i18n";
import type { BotRuntime } from "./runtime";

/**
 * GET /pay/<tizim>/<buyurtma>-<imzo> — botdagi to'lov tugmasining qisqa havolasi: Payme / Click to'lov
 * sahifasiga yo'naltiradi. Summa buyurtmadan olinadi; faqat to'lov tizimining o'z manziliga yo'naltiriladi
 * (open redirect yo'q). To'lov mumkinligini to'lov tizimining o'zi tekshiradi (Prepare / CheckPerform).
 *
 * ?tg=1 — Telegram Mini App sahifasi (tugma `web_app`): Telegram havolani tasdiqlash oynasini ko'rsatmaydi,
 * sahifa to'lov manzilini darhol tashqi brauzerda (u esa to'lov ilovasida) ochadi va o'zi yopiladi.
 */
const PAGE_TEXT: Record<Lang, { wait: string; open: string }> = {
  uz: { wait: "To'lov sahifasi ochilmoqda…", open: "To'lov sahifasini ochish" },
  ru: { wait: "Открываем страницу оплаты…", open: "Открыть страницу оплаты" },
  en: { wait: "Opening the payment page…", open: "Open the payment page" },
};

const attr = (s: string): string => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function miniAppPage(target: string, lang: Lang, nonce: string): string {
  const t = PAGE_TEXT[lang];
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t.wait}</title>
<style nonce="${nonce}">
body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:24px;box-sizing:border-box;font:16px system-ui,sans-serif;text-align:center;background:var(--tg-theme-bg-color,#fff);color:var(--tg-theme-text-color,#111)}
a{display:block;padding:14px 22px;border-radius:12px;text-decoration:none;font-weight:600;background:var(--tg-theme-button-color,#2481cc);color:var(--tg-theme-button-text-color,#fff)}
</style>
</head>
<body>
<p>${t.wait}</p>
<a id="go" href="${attr(target)}" target="_blank" rel="noopener">${t.open}</a>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<script nonce="${nonce}">
(function () {
  var link = document.getElementById("go");
  var tg = window.Telegram && window.Telegram.WebApp;
  // Telegram'dan tashqarida ochilgan (masalan, havola brauzerga nusxalangan) — oddiy yo'naltirish
  if (!tg || !tg.initData) return void location.replace(link.href);
  function open() { tg.openLink(link.href); }
  link.addEventListener("click", function (e) { e.preventDefault(); open(); });
  tg.ready();
  open();
  // Brauzerdagi Telegram yangi oynani bloklashi mumkin — u yerda sahifa (tugma bilan) ochiq qoladi
  if (!/^web/.test(tg.platform || "")) setTimeout(function () { tg.close(); }, 600);
})();
</script>
</body>
</html>`;
}

export function mountPayRedirect(app: Express, rt: BotRuntime): void {
  const limiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false });

  app.get("/pay/:provider/:ref", limiter, async (req, res) => {
    const provider = String(req.params.provider);
    const orderId = provider === "payme" || provider === "click" ? parsePayRef(provider, String(req.params.ref)) : null;
    const order =
      orderId !== null && payProviderEnabled(provider as PayProvider)
        ? await prisma.order.findUnique({ where: { id: orderId }, include: { user: { select: { language: true } } } })
        : null;
    if (!order) return void res.status(404).type("text/plain").send("Havola noto'g'ri yoki eskirgan");

    const back = returnUrl((await botUsername(rt.api)) ?? undefined);
    const lang = await userLang(order.user);
    const target =
      provider === "payme"
        ? paymeCheckoutUrl(order.id, order.amount, { returnUrl: back, lang })
        : clickCheckoutUrl(order.id, order.amount, { returnUrl: back });
    res.setHeader("Cache-Control", "no-store");
    if (req.query.tg !== "1") return void res.redirect(302, target);

    // Mini App sahifasi: Telegram skripti va (brauzerdagi Telegram uchun) iframe ichida ochilishga ruxsat —
    // faqat shu sahifa uchun, panelning umumiy CSP si o'zgarmaydi
    const nonce = randomBytes(16).toString("base64");
    res.removeHeader("X-Frame-Options");
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'nonce-${nonce}' https://telegram.org; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors https://web.telegram.org https://*.telegram.org`,
    );
    res.type("html").send(miniAppPage(target, lang, nonce));
  });
}
