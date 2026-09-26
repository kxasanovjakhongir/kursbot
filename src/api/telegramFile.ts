import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { Response } from "express";
import type { Api } from "grammy";
import { HttpError } from "./errors";

const TYPE_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

/**
 * Telegram'dagi faylni (chek, video) brauzerga proksi qiladi — bot tokeni tashqariga chiqmaydi.
 * Telegram getFile 20 MB gacha fayllarni beradi.
 */
export async function sendTelegramFile(res: Response, api: Api, fileId: string, fallbackType: string): Promise<void> {
  const file = await api.getFile(fileId).catch(() => null);
  if (!file?.file_path) throw new HttpError(413, "Fayl 20 MB dan katta yoki mavjud emas — uni faqat Telegram'da ko'rish mumkin");
  // Tokenli URL faqat server ichida; javob va loglarga chiqmaydi. Osilib qolmasligi uchun timeout
  const upstream = await fetch(`https://api.telegram.org/file/bot${api.token}/${file.file_path}`, { signal: AbortSignal.timeout(60_000) });
  if (!upstream.ok || !upstream.body) throw new HttpError(502, "Faylni Telegram'dan olib bo'lmadi");
  const ext = file.file_path.split(".").pop()?.toLowerCase() ?? "";
  // helmet nosniff yoqilgan — turi aniq ko'rsatiladi
  res.setHeader("Content-Type", TYPE_BY_EXT[ext] ?? fallbackType);
  res.setHeader("Cache-Control", "private, max-age=3600");
  const length = upstream.headers.get("content-length");
  if (length) res.setHeader("Content-Length", length);
  // Oqim: fayl to'liq xotiraga yuklanmaydi (20 MB × parallel so'rovlar = RAM tejaladi)
  try {
    await pipeline(Readable.fromWeb(upstream.body as WebReadableStream<Uint8Array>), res);
  } catch (err) {
    // Foydalanuvchi yuklanish tugamasdan oynani yopdi — oddiy holat, xato emas
    if ((err as NodeJS.ErrnoException).code === "ERR_STREAM_PREMATURE_CLOSE" || res.destroyed) return;
    throw err;
  }
}
