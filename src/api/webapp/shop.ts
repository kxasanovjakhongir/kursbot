import { Router } from "express";
import multer from "multer";
import { GrammyError, InputFile } from "grammy";
import { z } from "zod";
import { translate } from "../../i18n";
import { formatMoney, stripHtml } from "../../lib/format";
import { isBlockedError } from "../../bot/notify";
import { forwardReceiptToAdmins, submitReceipt } from "../../bot/receiptFlow";
import { RECEIPT_MIME } from "../../bot/handlers/receipt";
import { MIME_OF, safeFileName, sniffFileType } from "../../lib/fileType";
import { refreshInviteLink, listUserGrants } from "../../services/access";
import { trackEvent } from "../../services/events";
import { cancelOrder, createOrder, findOpenOrder, getUserOrder, listUserOrders, type IncomingReceipt } from "../../services/orders";
import { checkOwnership, getActiveProduct, listActiveProducts, ownershipMap } from "../../services/products";
import { getSettings } from "../../services/settings";
import { markBlocked } from "../../services/users";
import { HttpError } from "../errors";
import type { BotRuntime } from "../runtime";
import { paged, pagination, parseBigId, parseBody, parseQuery } from "../validate";
import { orderDetailDto, orderListDto, productDto } from "./dto";
import { session } from "./session";

// Chek: Telegram Bot API orqali yuklash limiti — 20 MB (settings.receipt_max_mb bilan qo'shimcha cheklanadi)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

const codeParam = z.string().regex(/^[\w-]{1,32}$/);

/** sendPhoto: 10 MB gacha va o'rtacha nisbatli rasm. Kattaroq yoki juda uzun chek skrinshoti — hujjat sifatida */
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

async function sendReceiptImage(rt: BotRuntime, chatId: number, buffer: Buffer, originalName: string, kind: string, caption: string): Promise<IncomingReceipt> {
  const name = safeFileName(originalName, `receipt.${kind === "jpeg" ? "jpg" : kind}`);
  if (buffer.length <= PHOTO_MAX_BYTES) {
    try {
      const m = await rt.api.sendPhoto(chatId, new InputFile(buffer, name), { caption });
      const photo = m.photo.at(-1)!;
      return { fileId: photo.file_id, fileUniqueId: photo.file_unique_id, fileType: "photo" };
    } catch (err) {
      // Telegram rasmni qabul qilmadi (o'lcham/nisbat) — hujjat sifatida yuboriladi; bloklash va tarmoq xatosi yuqoriga
      if (!(err instanceof GrammyError) || err.error_code !== 400) throw err;
    }
  }
  const m = await rt.api.sendDocument(chatId, new InputFile(buffer, name), { caption });
  return { fileId: m.document.file_id, fileUniqueId: m.document.file_unique_id, fileType: "image" };
}

function botBlocked(): HttpError {
  return new HttpError(409, "Bot sizga xabar yubora olmaydi. Botni oching va /start bosing", { code: "bot_blocked" });
}

export function shopRouter(rt: BotRuntime): Router {
  const r = Router();

  // ---------- Darsliklar ----------
  r.get("/products", async (req, res) => {
    const { user } = session(req);
    const products = await listActiveProducts();
    const owned = await ownershipMap(user.id, products);
    res.json({ items: products.map((p) => productDto(p, owned.get(p.id) ?? "none")) });
  });

  r.get("/products/:code", async (req, res) => {
    const { user } = session(req);
    const product = await getActiveProduct(codeParam.parse(req.params.code));
    if (!product) throw new HttpError(404, "Darslik topilmadi", { code: "not_found" });
    const [own, open] = await Promise.all([checkOwnership(user.id, product), findOpenOrder(user.id, product.id)]);
    await trackEvent(user.id, "product_view", { product: product.code, link: user.lastLinkId ?? null, via: "webapp" });
    res.json({ product: productDto(product, own.kind), openOrderId: open?.id.toString() ?? null });
  });

  /** Tanishtiruv videosi chatga yuboriladi — katta videolar ham Telegram pleerida tez ochiladi */
  r.post("/products/:code/video", async (req, res) => {
    const { user, lang } = session(req);
    const product = await getActiveProduct(codeParam.parse(req.params.code));
    if (!product?.videoFileId) throw new HttpError(404, "Video yo'q", { code: "not_found" });
    const price = product.price > 0 ? `<b>${formatMoney(product.price)} so'm</b>` : "—";
    const caption = await translate(lang, "product_caption", { mahsulot: product.title, tavsif: product.description }, { narx_qator: price });
    try {
      // Video izohi 1024 belgigacha: uzun tavsif bo'lsa — video va matn alohida
      if (stripHtml(caption).length <= 1024) {
        await rt.api.sendVideo(Number(user.telegramId), product.videoFileId, { caption, parse_mode: "HTML" });
      } else {
        await rt.api.sendVideo(Number(user.telegramId), product.videoFileId);
        await rt.api.sendMessage(Number(user.telegramId), caption, { parse_mode: "HTML" });
      }
    } catch (err) {
      if (!isBlockedError(err)) throw err;
      await markBlocked(user.telegramId);
      throw botBlocked();
    }
    await trackEvent(user.id, "video", { product: product.code, via: "webapp" });
    res.json({ sent: true });
  });

  // ---------- Buyurtmalar ----------
  /** "Darslikni olaman" — botdagi bilan bir xil qoidalar: telefon, egalik, ochiq buyurtma (BR-01), narx qotiriladi */
  r.post("/orders", async (req, res) => {
    const { user } = session(req);
    const { productCode } = parseBody(z.object({ productCode: codeParam }), req);
    const product = await getActiveProduct(productCode);
    if (!product) throw new HttpError(404, "Darslik topilmadi", { code: "not_found" });
    if (!user.phone) throw new HttpError(409, "Avval telefon raqamingizni ulashing", { code: "phone_required" });

    const own = await checkOwnership(user.id, product);
    if (own.kind === "owned") throw new HttpError(409, "Siz bu darslikni olgansiz", { code: "already_owned" });
    if (own.kind === "partial") {
      throw new HttpError(409, "To'plamdagi darsliklardan biri sizda bor", { code: "partial_owned", missing: own.missing.map((p) => p.code) });
    }

    const result = await createOrder(user.id, product, user.lastSource ?? "webapp");
    if (result.kind === "no_card" || result.kind === "no_price") {
      throw new HttpError(503, "To'lov ma'lumotlari hozircha tayyor emas", { code: "payment_unavailable" });
    }
    if (result.kind === "created") {
      await trackEvent(user.id, "order", { product: product.code, orderId: result.order.id.toString(), via: "webapp" });
    }
    res.status(result.kind === "created" ? 201 : 200).json({ id: result.order.id.toString(), created: result.kind === "created" });
  });

  r.get("/orders", async (req, res) => {
    const { page, pageSize } = parseQuery(pagination, req);
    const { items, total } = await listUserOrders(session(req).user.id, page, pageSize);
    res.json(paged(items.map(orderListDto), total, page, pageSize));
  });

  r.get("/orders/:id", async (req, res) => {
    const order = await getUserOrder(session(req).user.id, parseBigId(req.params.id));
    if (!order) throw new HttpError(404, "Buyurtma topilmadi", { code: "not_found" });
    const { max_receipt_attempts } = await getSettings();
    res.json(orderDetailDto(order, max_receipt_attempts));
  });

  r.post("/orders/:id/cancel", async (req, res) => {
    const { user } = session(req);
    const id = parseBigId(req.params.id);
    if (!(await cancelOrder(user.id, id))) {
      throw new HttpError(409, "Bu buyurtmani bekor qilib bo'lmaydi", { code: "cannot_cancel" });
    }
    await trackEvent(user.id, "order_cancelled", { orderId: id.toString(), via: "webapp" });
    res.json({ ok: true });
  });

  /**
   * Chek yuklash: fayl foydalanuvchi chatiga yuboriladi (Telegram file_id olinadi, chek chatda ham qoladi),
   * keyin botdagi bilan bir xil jarayon — dublikat tekshiruvi, urinishlar, admin guruhiga kartochka.
   */
  r.post("/orders/:id/receipt", upload.single("file"), async (req, res) => {
    const { user, lang } = session(req);
    const orderId = parseBigId(String(req.params.id));
    const file = req.file;
    if (!file) throw new HttpError(400, "Fayl tanlanmagan", { code: "file_required" });
    // Haqiqiy tur fayl baytlaridan aniqlanadi (Content-Type ni klient soxtalashtirishi mumkin)
    const kind = sniffFileType(file.buffer);
    if (!kind || !RECEIPT_MIME.has(MIME_OF[kind])) throw new HttpError(400, "Faqat rasm (JPG, PNG) yoki PDF", { code: "file_type" });
    const settings = await getSettings();
    if (file.size > settings.receipt_max_mb * 1024 * 1024) {
      throw new HttpError(413, `Fayl ${settings.receipt_max_mb} MB dan oshmasligi kerak`, { code: "file_too_big", maxMb: settings.receipt_max_mb });
    }

    // Telegram'ga yuklashdan oldin tez tekshiruv — yopiq buyurtmaga fayl yuborilmaydi
    const order = await getUserOrder(user.id, orderId);
    if (!order) throw new HttpError(404, "Buyurtma topilmadi", { code: "not_found" });
    if (order.status === "receipt_sent") throw new HttpError(409, "Chek allaqachon tekshirilmoqda", { code: "under_review" });
    if (!orderListDto(order).canUploadReceipt) throw new HttpError(409, "Buyurtma yopilgan", { code: "closed" });
    if (order.attempts >= settings.max_receipt_attempts) throw new HttpError(409, "Urinishlar tugadi", { code: "max_attempts" });

    const caption = await translate(lang, "receipt_from_app", { raqam: orderId.toString() });
    let incoming: IncomingReceipt;
    try {
      if (kind === "pdf") {
        const m = await rt.api.sendDocument(Number(user.telegramId), new InputFile(file.buffer, safeFileName(file.originalname, "receipt.pdf")), { caption });
        incoming = { fileId: m.document.file_id, fileUniqueId: m.document.file_unique_id, fileType: "pdf" };
      } else {
        incoming = await sendReceiptImage(rt, Number(user.telegramId), file.buffer, file.originalname, kind, caption);
      }
    } catch (err) {
      if (!isBlockedError(err)) throw err;
      await markBlocked(user.telegramId);
      throw botBlocked();
    }

    const result = await submitReceipt(user.id, orderId, incoming);
    if (result.kind !== "ok") {
      const message = { under_review: "Chek allaqachon tekshirilmoqda", closed: "Buyurtma yopilgan", max_attempts: "Urinishlar tugadi" }[result.kind];
      throw new HttpError(409, message, { code: result.kind });
    }
    await forwardReceiptToAdmins(rt.api, result);
    res.status(201).json({ status: "receipt_sent", working: result.working, workStart: result.workStart });
  });

  // ---------- Olingan darsliklar ----------
  r.get("/purchases", async (req, res) => {
    const grants = await listUserGrants(session(req).user.id);
    res.json({
      items: grants.map((g) => ({
        id: g.id.toString(),
        product: { code: g.product.code, title: g.product.title },
        joined: !!g.joinedAt,
        expiresAt: g.expiresAt,
        createdAt: g.createdAt,
      })),
    });
  });

  /** Kanal linki: shaxsiy, bir martalik; eskirgan bo'lsa yangisi yaratiladi */
  r.post("/purchases/:id/link", async (req, res) => {
    const { user } = session(req);
    const grant = await refreshInviteLink(rt.api, parseBigId(req.params.id), user.telegramId);
    if (!grant?.inviteLink) throw new HttpError(502, "Linkni olib bo'lmadi. Admin bilan bog'laning", { code: "link_failed" });
    res.json({ url: grant.inviteLink, expiresAt: grant.linkExpiresAt });
  });

  return r;
}
