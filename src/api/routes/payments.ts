import express, { Router, type ErrorRequestHandler } from "express";
import { clickEnabled, paymeEnabled } from "../../config";
import { handlePayme, PAYME_ERRORS, paymeProtocolError } from "../../services/payments/payme";
import { handleClick } from "../../services/payments/click";
import { onOnlinePaid, onOnlineRefund, runInBackground } from "../../bot/payments";
import type { BotRuntime } from "../runtime";

/**
 * To'lov tizimlari uchun ochiq endpointlar (JWT yo'q — Payme Basic auth, Click MD5 imzo bilan tekshiriladi):
 *   POST /api/payments/payme            — Payme Merchant API (JSON-RPC)
 *   POST /api/payments/click/prepare    — Click Shop API, 1-bosqich
 *   POST /api/payments/click/complete   — Click Shop API, 2-bosqich
 * Sozlanmagan tizim endpointi 404 qaytaradi.
 * Payme har doim HTTP 200 kutadi (boshqa status — -32400), shuning uchun protokol xatolari ham JSON-RPC shaklida.
 */
export function paymentsRouter(rt: BotRuntime): Router {
  const r = Router();

  // Payme hujjatidagi so'rov namunasi "Content-Type: text/json" — sarlavhaga qaramay JSON sifatida o'qiladi
  r.post("/payme", express.json({ limit: "64kb", type: () => true }), async (req, res) => {
    if (!paymeEnabled()) {
      res.status(404).json({ error: "Payme sozlanmagan" });
      return;
    }
    const out = await handlePayme(req.body, req.get("authorization"));
    res.json(out.body);
    if (out.paidOrderId) {
      const id = out.paidOrderId;
      runInBackground("Payme: to'lovdan keyingi amallar bajarilmadi", () => onOnlinePaid(rt.api, id, "payme", !!out.duplicatePayment));
    }
    if (out.refundedOrderId) {
      const id = out.refundedOrderId;
      runInBackground("Payme: qaytarishdan keyingi amallar bajarilmadi", () => onOnlineRefund(rt.api, id, "payme"));
    }
  });
  // Buzuq JSON — -32700 (HTTP 200)
  r.use("/payme", ((err, _req, res, next) => {
    if ((err as { type?: string })?.type !== "entity.parse.failed") return next(err);
    res.json(paymeProtocolError(PAYME_ERRORS.parse));
  }) as ErrorRequestHandler);
  // POST dan boshqa metod — -32300
  r.all("/payme", (_req, res) => {
    if (!paymeEnabled()) {
      res.status(404).json({ error: "Payme sozlanmagan" });
      return;
    }
    res.json(paymeProtocolError(PAYME_ERRORS.notPost));
  });

  const form = [express.urlencoded({ extended: false, limit: "16kb" }), express.json({ limit: "16kb" })];
  for (const [path, action] of [["/click/prepare", 0], ["/click/complete", 1]] as const) {
    r.post(path, ...form, async (req, res) => {
      if (!clickEnabled()) {
        res.status(404).json({ error: "Click sozlanmagan" });
        return;
      }
      const out = await handleClick(req.body, action);
      res.json(out.body);
      if (out.paidOrderId) {
        const id = out.paidOrderId;
        runInBackground("Click: to'lovdan keyingi amallar bajarilmadi", () => onOnlinePaid(rt.api, id, "click", !!out.duplicatePayment));
      }
      if (out.refundedOrderId) {
        const id = out.refundedOrderId;
        runInBackground("Click: qaytarishdan keyingi amallar bajarilmadi", () => onOnlineRefund(rt.api, id, "click"));
      }
    });
  }

  return r;
}
