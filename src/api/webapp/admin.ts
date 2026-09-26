import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { approveAndNotify, rejectAndNotify } from "../../bot/admin/reviewActions";
import { audit } from "../../services/events";
import { pendingReceiptOrders } from "../../services/orders";
import { getDashboardStats } from "../../services/stats";
import { banUser, unbanUser } from "../../services/membership";
import { searchUsers } from "../../services/users";
import { HttpError } from "../errors";
import { parseRejectInput, rejectReasonList, rejectSchema } from "../rejectInput";
import type { BotRuntime } from "../runtime";
import { sendTelegramFile } from "../telegramFile";
import { paged, pagination, parseBigId, parseBody, parseQuery } from "../validate";
import { assertAppPermission } from "./session";

/**
 * Mini App ichidagi admin bo'limi. Rol — Telegram adminlari jadvalidan (botdagi bilan bir xil),
 * har bir amal ruxsat jadvali bo'yicha tekshiriladi va audit logga yoziladi.
 */
export function adminRouter(rt: BotRuntime): Router {
  const r = Router();

  r.get("/stats", async (req, res) => {
    assertAppPermission(req, "stats.view");
    res.json(await getDashboardStats());
  });

  // ---------- Cheklar ----------
  r.get("/receipts", async (req, res) => {
    assertAppPermission(req, "orders.review");
    const orders = await pendingReceiptOrders(50);
    res.json({
      items: orders.map((o) => ({
        orderId: o.id.toString(),
        amount: o.amount,
        attempts: o.attempts,
        shortfall: o.shortfall,
        product: { title: o.product.title },
        user: {
          firstName: o.user.firstName,
          lastName: o.user.lastName,
          username: o.user.username,
          phone: o.user.phone,
          isForeign: o.user.isForeign,
        },
        receipt: o.receipts[0]
          ? { fileType: o.receipts[0].fileType, isDuplicate: o.receipts[0].isDuplicate, createdAt: o.receipts[0].createdAt }
          : null,
      })),
      reasons: rejectReasonList(),
    });
  });

  /** Oxirgi chek fayli (rasm yoki PDF) — Telegram'dan proksi */
  r.get("/receipts/:orderId/file", async (req, res) => {
    assertAppPermission(req, "orders.review");
    const receipt = await prisma.receipt.findFirst({ where: { orderId: parseBigId(req.params.orderId) }, orderBy: { id: "desc" } });
    if (!receipt) throw new HttpError(404, "Chek topilmadi", { code: "not_found" });
    await sendTelegramFile(res, rt.api, receipt.fileId, "image/jpeg");
  });

  r.post("/orders/:id/approve", async (req, res) => {
    const { admin } = assertAppPermission(req, "orders.review");
    const id = parseBigId(req.params.id);
    const ok = await approveAndNotify(rt.api, id, { adminId: admin!.id });
    if (!ok) throw new HttpError(409, "Bu chek allaqachon ko'rib chiqilgan", { code: "already_reviewed" });
    await audit(admin!.id, "approve", "order", id, { status: "receipt_sent" }, { status: "approved", via: "webapp" });
    res.json({ ok: true });
  });

  r.post("/orders/:id/reject", async (req, res) => {
    const { admin } = assertAppPermission(req, "orders.review");
    const id = parseBigId(req.params.id);
    const { code, extra } = parseRejectInput(parseBody(rejectSchema, req));
    const result = await rejectAndNotify(rt.api, id, code, extra, { adminId: admin!.id });
    if (!result.ok) throw new HttpError(409, "Bu chek allaqachon ko'rib chiqilgan", { code: "already_reviewed" });
    await audit(admin!.id, "reject", "order", id, { status: "receipt_sent" }, { status: "rejected", reason: result.stored, via: "webapp" });
    res.json({ ok: true });
  });

  // ---------- Foydalanuvchilar ----------
  r.get("/users", async (req, res) => {
    assertAppPermission(req, "users.view");
    const query = parseQuery(
      pagination.extend({
        q: z.string().trim().max(100).optional(),
        status: z.enum(["all", "active", "blocked", "banned"]).default("all"),
      }),
      req,
    );
    const { items, total } = await searchUsers(query);
    res.json(
      paged(
        items.map((u) => ({ ...u, id: u.id.toString(), telegramId: u.telegramId.toString() })),
        total,
        query.page,
        query.pageSize,
      ),
    );
  });

  const setUserBan = (banned: boolean) =>
    async function handler(req: Request, res: Response) {
      const { admin } = assertAppPermission(req, "users.manage");
      const id = parseBigId(String(req.params.id));
      const target = await prisma.user.findUnique({ where: { id } });
      if (!target) throw new HttpError(404, "Foydalanuvchi topilmadi", { code: "not_found" });
      // Mini App'dan cheklash ham kanallardan chiqaradi (panel bilan bir xil)
      const { user: updated } = banned ? await banUser(rt.api, id, true) : await unbanUser(id);
      await audit(admin!.id, banned ? "ban_user" : "unban_user", "user", id, { isBanned: target.isBanned }, { isBanned: banned, via: "webapp" });
      res.json({ id: updated.id.toString(), isBanned: updated.isBanned });
    };
  r.post("/users/:id/ban", setUserBan(true));
  r.post("/users/:id/unban", setUserBan(false));

  return r;
}
