import type { ErrorRequestHandler, RequestHandler } from "express";
import { GrammyError, HttpError as GrammyHttpError } from "grammy";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { MulterError } from "multer";
import { logger } from "../lib/logger";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (_req, _res, next) => next(new HttpError(404, "Topilmadi"));

/** Global xato ushlagich: har doim { error, details? } shaklida javob */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  // Javob (masalan, fayl oqimi) boshlanib bo'lgan — qayta yozib bo'lmaydi; Express ulanishni yopadi
  if (res.headersSent) {
    logger.warn({ err, path: req.path }, "javob yuborilayotganda xato");
    next(err);
    return;
  }
  if (err instanceof HttpError) {
    // Mashina o'qiydigan kod (masalan PASSWORD_CHANGE_REQUIRED) yuqori darajada ham beriladi
    const code = typeof err.details === "object" && err.details !== null && "code" in err.details ? err.details.code : undefined;
    res.status(err.status).json({ error: err.message, code, details: err.details });
    return;
  }
  if (err instanceof MulterError) {
    const tooBig = err.code === "LIMIT_FILE_SIZE";
    res.status(tooBig ? 413 : 400).json({ error: tooBig ? "Fayl hajmi juda katta" : "Fayl yuklashda xato", details: { code: tooBig ? "file_too_big" : "upload_error" } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Ma'lumotlar noto'g'ri", details: err.flatten().fieldErrors });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      res.status(409).json({ error: "Bunday yozuv allaqachon mavjud" });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ error: "Topilmadi" });
      return;
    }
  }
  if (err instanceof GrammyError) {
    logger.warn({ err: err.description, method: err.method }, "Telegram API xatosi");
    res.status(502).json({ error: `Telegram API xatosi: ${err.description}` });
    return;
  }
  if (err instanceof GrammyHttpError) {
    res.status(503).json({ error: "Telegram serveriga ulanib bo'lmadi" });
    return;
  }
  if (typeof err === "object" && err !== null && "type" in err) {
    // body-parser xatolari — mijoz xatosi (500 va "server xatosi" logi emas)
    if (err.type === "entity.parse.failed") {
      res.status(400).json({ error: "JSON noto'g'ri" });
      return;
    }
    if (err.type === "entity.too.large") {
      res.status(413).json({ error: "So'rov hajmi juda katta", details: { code: "payload_too_large" } });
      return;
    }
  }
  logger.error({ err, path: req.path }, "API xatosi");
  res.status(500).json({ error: "Serverda xatolik yuz berdi" });
};
