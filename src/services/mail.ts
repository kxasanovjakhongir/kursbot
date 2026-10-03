import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config";
import { escapeHtml } from "../lib/format";
import { logger } from "../lib/logger";

/**
 * Email yuborish (nodemailer, SMTP). Sozlamalar faqat .env dan: SMTP_HOST, SMTP_PORT, SMTP_USER,
 * SMTP_PASS, MAIL_FROM. SMTP_HOST bo'lmasa xat yuborilmaydi — chaqiruvchi buni bilib oladi (false).
 * Xat matni (kod, parol) hech qachon logga yozilmaydi.
 */
export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type MailSender = (message: MailMessage) => Promise<void>;

let transporter: Transporter | null = null;

function smtpTransport(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    // 465 — to'g'ridan-to'g'ri TLS; boshqa portlarda STARTTLS (server qo'llasa majburiy)
    secure: config.SMTP_PORT === 465,
    requireTLS: config.SMTP_PORT !== 465 && config.SMTP_PORT !== 25,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

const smtpSender: MailSender = async (message) => {
  await smtpTransport().sendMail({ from: config.MAIL_FROM ?? config.SMTP_USER, ...message });
};

let sender: MailSender | null = null;

/** Testlar uchun: SMTP o'rniga xatlarni ushlab qoluvchi funksiya (null — standart SMTP) */
export function setMailSender(fn: MailSender | null): void {
  sender = fn;
}

export function isMailConfigured(): boolean {
  return !!sender || !!config.SMTP_HOST;
}

/** true — xat yuborildi; false — SMTP sozlanmagan yoki yuborishda xato (sababi logda, matnsiz) */
export async function sendMail(message: MailMessage): Promise<boolean> {
  const send = sender ?? (config.SMTP_HOST ? smtpSender : null);
  if (!send) {
    logger.warn("SMTP sozlanmagan (SMTP_HOST) — email yuborilmadi");
    return false;
  }
  try {
    await send(message);
    return true;
  } catch (err) {
    // Faqat xato turi va kod: xat matni (OTP) logga tushmaydi
    const e = err as { code?: string; responseCode?: number; message?: string };
    logger.error({ code: e.code, responseCode: e.responseCode, reason: e.message?.slice(0, 200) }, "email yuborilmadi");
    return false;
  }
}

/** "Parolni unutdim" — tasdiqlash kodi xati (o'zbekcha, oddiy HTML) */
export function passwordResetEmail(to: string, name: string, code: string, ttlMinutes: number): MailMessage {
  const safeName = escapeHtml(name);
  return {
    to,
    // Kod mavzuda emas — telefon ekranidagi bildirishnomada ko'rinib qolmasligi uchun
    subject: "Admin panelga kirish kodi",
    text: [
      `Assalomu alaykum, ${name}!`,
      "",
      `Admin panelga kirish uchun tasdiqlash kodi: ${code}`,
      `Kod ${ttlMinutes} daqiqa amal qiladi va faqat bir marta ishlatiladi.`,
      "Kirgandan keyin yangi parol o'rnatishingiz so'raladi.",
      "",
      "Agar siz so'ramagan bo'lsangiz, bu xatni e'tiborsiz qoldiring — parolingiz o'zgarmaydi.",
    ].join("\n"),
    html: `<!doctype html>
<html lang="uz">
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827">
    <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
      <tr><td>
        <h1 style="margin:0 0 16px;font-size:20px">Admin panelga kirish kodi</h1>
        <p style="margin:0 0 16px">Assalomu alaykum, ${safeName}!</p>
        <p style="margin:0 0 12px">Parolni tiklash uchun tasdiqlash kodi:</p>
        <p style="margin:0 0 20px;font-size:32px;font-weight:bold;letter-spacing:8px;font-family:'Courier New',monospace">${code}</p>
        <p style="margin:0 0 8px">Kod <b>${ttlMinutes} daqiqa</b> amal qiladi va faqat bir marta ishlatiladi.</p>
        <p style="margin:0 0 20px">Kirgandan keyin yangi parol o'rnatishingiz so'raladi.</p>
        <p style="margin:0;padding-top:16px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px">
          Agar siz so'ramagan bo'lsangiz, bu xatni e'tiborsiz qoldiring — parolingiz o'zgarmaydi.
        </p>
      </td></tr>
    </table>
  </body>
</html>`,
  };
}
