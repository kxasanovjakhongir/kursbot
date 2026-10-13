import express, { Router } from "express";
import { clickEnabled, paymeEnabled } from "../../config";
import { handlePayme } from "../../services/payments/payme";
import { handleClick } from "../../services/payments/click";
import { onOnlinePaid, onOnlineRefund, runInBackground } from "../../bot/payments";
import type { BotRuntime } from "../runtime";

/**
 * To'lov tizimlari uchun ochiq endpointlar (JWT yo'q — Payme Basic auth, Click MD5 imzo bilan tekshiriladi):
 *   POST /api/payments/payme            — Payme Merchant API (JSON-RPC)
 *   POST /api/payments/click/prepare    — Click Shop API, 1-bosqich
 *   POST /api/payments/click/complete   — Click Shop API, 2-bosqich
 * Sozlanmagan tizim endpointi 404 qaytaradi.
 */
export function paymentsRouter(rt: BotRuntime): Router {
  const r = Router();

  r.post("/payme", express.json({ limit: "64kb" }), async (req, res) => {
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
    });
  }

  return r;
}
