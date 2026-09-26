import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

/**
 * Texnik xatolar (logger.error / logger.fatal) → error_logs jadvali (panel: "Xatoliklar").
 *
 * Pino ga ikkinchi oqim sifatida ulanadi va tayyor (redact qilingan) JSON qatorni oladi — token, parol
 * va telefonlar bazaga niqoblangan holda tushadi. Bir xil xato bitta yozuvga guruhlanadi (fingerprint),
 * yozuvlar xotirada yig'ilib har FLUSH_MS da bir marta bazaga yoziladi: xato "bo'roni" bazani bosib
 * qo'ymaydi. Baza ishlamasa — yozuv tashlab yuboriladi (logga yozilmaydi: aks holda xato → log → xato halqasi).
 */

const FLUSH_MS = 3_000;
const MAX_PENDING = 200;
const MAX_TEXT = 4_000;
const MAX_CONTEXT = 8_000;
/** Pino'ning standart maydonlari — kontekstga kirmaydi */
const BASE_KEYS = new Set(["level", "time", "pid", "hostname", "service", "msg", "err", "error"]);

interface Pending {
  level: string;
  message: string;
  errorType: string | null;
  errorText: string | null;
  stack: string | null;
  context: Record<string, unknown> | null;
  count: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

const pending = new Map<string, Pending>();
/** db.ts ulaydi (bu modul db ni import qilmaydi: db.ts logger'ni, logger esa shu modulni import qiladi) */
let store: Pick<PrismaClient, "errorLog"> | null = null;

export function setErrorLogStore(client: Pick<PrismaClient, "errorLog">): void {
  store = client;
}
let timer: NodeJS.Timeout | null = null;
let flushing: Promise<void> | null = null;
/** Bazaga yozish davom etmoqda (shu paytdagi Prisma "error" hodisalari qayta yig'ilmaydi) */
let writing = false;
/** Baza yozuvni qabul qilmasa (masalan, ishlamayapti) — bir muddat yig'ish to'xtatiladi */
let pausedUntil = 0;
const PAUSE_MS = 60_000;

const clip = (s: string | null | undefined, max = MAX_TEXT) => (s ? (s.length > max ? `${s.slice(0, max)}…` : s) : null);

/** Raqam, ID, hex va vaqtlar farq qilsa ham bir xil xato bitta guruhga tushsin */
function normalize(s: string): string {
  return s
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hex>")
    .replace(/-?\d+(\.\d+)?/g, "#")
    .slice(0, 300);
}

export function fingerprintOf(message: string, errorType: string | null, errorText: string | null): string {
  const firstLine = (errorText ?? "").split("\n")[0] ?? "";
  return createHash("sha1").update(`${normalize(message)}|${errorType ?? ""}|${normalize(firstLine)}`).digest("hex");
}

function levelName(level: unknown): string {
  return level === 60 ? "fatal" : "error";
}

/** Pino JSON qatorini yozuvga aylantiradi (test uchun alohida) */
export function parseLogLine(line: string): (Pending & { fingerprint: string }) | null {
  let rec: Record<string, unknown>;
  try {
    rec = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof rec.level !== "number" || rec.level < 50) return null;
  const err = (rec.err ?? rec.error) as { type?: string; message?: string; stack?: string } | string | undefined;
  const errorType = typeof err === "object" && err ? (err.type ?? null) : null;
  const errorText = clip(typeof err === "string" ? err : typeof err === "object" && err ? (err.message ?? null) : null);
  const stack = clip(typeof err === "object" && err ? (err.stack ?? null) : null);
  const message = clip(typeof rec.msg === "string" && rec.msg ? rec.msg : (errorText ?? "Noma'lum xato"), 500)!;

  let context: Record<string, unknown> | null = null;
  const extra = Object.fromEntries(Object.entries(rec).filter(([k]) => !BASE_KEYS.has(k)));
  if (Object.keys(extra).length) {
    const json = JSON.stringify(extra);
    context = json.length > MAX_CONTEXT ? { truncated: json.slice(0, MAX_CONTEXT) } : extra;
  }
  const at = typeof rec.time === "string" || typeof rec.time === "number" ? new Date(rec.time) : new Date();
  const seen = Number.isNaN(at.getTime()) ? new Date() : at;
  return {
    fingerprint: fingerprintOf(message, errorType, errorText),
    level: levelName(rec.level),
    message,
    errorType,
    errorText,
    stack,
    context,
    count: 1,
    firstSeenAt: seen,
    lastSeenAt: seen,
  };
}

function collect(line: string): void {
  if (Date.now() < pausedUntil) return;
  const e = parseLogLine(line);
  if (!e) return;
  // Yozish paytida Prisma'ning o'z "error" hodisasi (db.ts: { target }) — halqa bo'lmasin; boshqa xatolar yig'iladi
  if (writing && e.context && "target" in e.context) return;
  const prev = pending.get(e.fingerprint);
  if (prev) {
    prev.count++;
    prev.lastSeenAt = e.lastSeenAt;
    prev.errorText = e.errorText;
    prev.stack = e.stack;
    prev.context = e.context;
  } else {
    if (pending.size >= MAX_PENDING) return;
    const { fingerprint, ...rest } = e;
    pending.set(fingerprint, rest);
  }
  timer ??= setTimeout(() => void flushErrorLogs(), FLUSH_MS).unref();
}

/** Yig'ilgan xatolarni bazaga yozadi. Qayta ochilgan (avval "hal qilingan") xato yana ochiq bo'ladi */
export function flushErrorLogs(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const prisma = store;
  if (!prisma) return Promise.resolve();
  flushing ??= (async () => {
    try {
      while (pending.size) {
        const batch = [...pending.entries()];
        pending.clear();
        for (const [fingerprint, e] of batch) {
          const context = (e.context ?? undefined) as object | undefined;
          writing = true;
          await prisma.errorLog
            .upsert({
              where: { fingerprint },
              create: { fingerprint, ...e, context },
              update: {
                count: { increment: e.count },
                lastSeenAt: e.lastSeenAt,
                resolvedAt: null,
                level: e.level,
                errorText: e.errorText,
                stack: e.stack,
                context,
              },
            })
            .catch(() => {
              pausedUntil = Date.now() + PAUSE_MS;
            })
            .finally(() => {
              writing = false;
            });
          if (Date.now() < pausedUntil) {
            pending.clear();
            return;
          }
        }
      }
    } catch {
      pending.clear();
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/** Pino multistream uchun oqim (faqat error va fatal darajalari yo'naltiriladi) */
export const errorSinkStream = { write: collect };
