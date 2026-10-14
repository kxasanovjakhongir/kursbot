import type { Express } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../db";
import { botUsername } from "../services/botInfo";
import { clickCheckoutUrl } from "../services/payments/click";
import { returnUrl } from "../services/payments/common";
import { parsePayRef, payProviderEnabled, type PayProvider } from "../services/payments/payLink";
import { paymeCheckoutUrl } from "../services/payments/payme";
import { userLang } from "../services/users";
import { applyPriceDrop } from "../services/orders";
import type { BotRuntime } from "./runtime";

/**
 * GET /pay/<tizim>/<buyurtma>-<imzo> — botdagi to'lov tugmasining qisqa havolasi: Payme / Click to'lov
 * sahifasiga yo'naltiradi. Summa buyurtmadan olinadi; faqat to'lov tizimining o'z manziliga yo'naltiriladi
 * (open redirect yo'q). To'lov mumkinligini to'lov tizimining o'zi tekshiradi (Prepare / CheckPerform).
 */
export function mountPayRedirect(app: Express, rt: BotRuntime): void {
  const limiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false });

  app.get("/pay/:provider/:ref", limiter, async (req, res) => {
    const provider = String(req.params.provider);
    const orderId = provider === "payme" || provider === "click" ? parsePayRef(provider, String(req.params.ref)) : null;
    const found =
      orderId !== null && payProviderEnabled(provider as PayProvider)
        ? await prisma.order.findUnique({ where: { id: orderId }, include: { user: { select: { language: true } }, product: { select: { price: true } } } })
        : null;
    if (!found) return void res.status(404).type("text/plain").send("Havola noto'g'ri yoki eskirgan");
    // To'lov ekrani ochilgandan keyin chegirma qo'yilgan bo'lsa — yangi narx
    const order = await applyPriceDrop(found, found.product);

    const back = returnUrl((await botUsername(rt.api)) ?? undefined);
    res.setHeader("Cache-Control", "no-store");
    res.redirect(
      302,
      provider === "payme"
        ? paymeCheckoutUrl(order.id, order.amount, { returnUrl: back, lang: await userLang(order.user) })
        : clickCheckoutUrl(order.id, order.amount, { returnUrl: back }),
    );
  });
}
