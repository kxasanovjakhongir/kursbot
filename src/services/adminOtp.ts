import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import type { PanelUser } from "@prisma/client";
import { prisma } from "../db";
import { logActivity } from "./activity";
import { passwordResetEmail, sendMail } from "./mail";

/** "Parolni unutdim": emailga 6 xonali bir martalik kod, 10 daqiqa, 5 ta urinish */
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
const OTP_LENGTH = 6;
// Kod 6 xonali — tez tekshiruv yetarli (urinishlar soni baribir 5 ta bilan cheklangan)
const OTP_BCRYPT_ROUNDS = 10;

// Admin topilmasa ham bcrypt ishlaydi — javob vaqtidan email borligini bilib bo'lmaydi
const DUMMY_HASH = bcrypt.hashSync("000000", OTP_BCRYPT_ROUNDS);

/** crypto.randomInt — kriptografik tasodif; boshidagi nollar saqlanadi (000123) */
export function generateOtp(): string {
  return randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, "0");
}

const findAdmin = (email: string) => prisma.panelUser.findUnique({ where: { email: email.trim().toLowerCase() } });

/**
 * Kod so'rash. Natija tashqariga chiqmaydi (route har doim bir xil javob beradi):
 * email ro'yxatda yo'q yoki admin o'chirilgan bo'lsa — hech narsa yuborilmaydi.
 */
export async function requestPasswordReset(email: string, ip: string | null): Promise<void> {
  const admin = await findAdmin(email);
  if (!admin || !admin.isActive) {
    await logActivity(null, "OTP_REQUESTED", "Parol tiklash kodi so'raldi: email ro'yxatda yo'q yoki faol emas", ip);
    return;
  }
  const code = generateOtp();
  const codeHash = await bcrypt.hash(code, OTP_BCRYPT_ROUNDS);
  await prisma.$transaction([
    // Avvalgi ishlatilmagan kodlar bekor qilinadi — faqat oxirgisi ishlaydi
    prisma.adminOtp.updateMany({ where: { adminId: admin.id, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.adminOtp.create({ data: { adminId: admin.id, codeHash, expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000) } }),
  ]);
  const sent = await sendMail(passwordResetEmail(admin.email, admin.name, code, OTP_TTL_MINUTES));
  await logActivity(admin.id, "OTP_REQUESTED", sent ? "Parol tiklash kodi emailga yuborildi" : "Parol tiklash kodi so'raldi, lekin email yuborilmadi (SMTP)", ip);
}

export type VerifyResult = { ok: true; admin: PanelUser } | { ok: false; remainingAttempts: number };

/**
 * Kodni tekshirish: eng oxirgi faol kod olinadi. Muddati o'tgan, ishlatilgan yoki 5 ta xato
 * kiritilgan kod rad etiladi. To'g'ri bo'lsa kod ishlatilgan deb belgilanadi (qayta ishlamaydi)
 * va admin yangi parol o'rnatmaguncha faqat parol sahifasiga kira oladi.
 */
export async function verifyPasswordResetOtp(email: string, code: string, ip: string | null): Promise<VerifyResult> {
  const admin = await findAdmin(email);
  const otp =
    admin && admin.isActive
      ? await prisma.adminOtp.findFirst({ where: { adminId: admin.id, usedAt: null }, orderBy: { createdAt: "desc" } })
      : null;
  const usable = otp && otp.expiresAt > new Date() && otp.attempts < OTP_MAX_ATTEMPTS;
  // bcrypt.compare — vaqt bo'yicha xavfsiz; kod bo'lmasa ham soxta xesh bilan ishlaydi
  const match = await bcrypt.compare(code, usable && otp ? otp.codeHash : DUMMY_HASH);

  if (!admin || !otp || !usable) {
    await logActivity(admin?.id ?? null, "OTP_FAILED", "Parol tiklash kodi: faol kod yo'q, muddati o'tgan yoki bloklangan", ip);
    return { ok: false, remainingAttempts: 0 };
  }

  if (!match) {
    // Atomik: bir vaqtda yuborilgan so'rovlar ham 5 tadan ortiq urinish bera olmaydi
    await prisma.adminOtp.updateMany({ where: { id: otp.id, usedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } } });
    const attempts = (await prisma.adminOtp.findUniqueOrThrow({ where: { id: otp.id }, select: { attempts: true } })).attempts;
    const remainingAttempts = Math.max(0, OTP_MAX_ATTEMPTS - attempts);
    // 5-xatodan keyin kod butunlay bekor
    if (remainingAttempts === 0) await prisma.adminOtp.update({ where: { id: otp.id }, data: { usedAt: new Date() } });
    await logActivity(admin.id, "OTP_FAILED", `Parol tiklash kodi noto'g'ri kiritildi (qolgan urinish: ${remainingAttempts})`, ip);
    return { ok: false, remainingAttempts };
  }

  // Bir kod bilan faqat bitta so'rov kira oladi (parallel so'rovlar ham)
  const claimed = await prisma.adminOtp.updateMany({
    where: { id: otp.id, usedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS }, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return { ok: false, remainingAttempts: 0 };

  const updated = await prisma.panelUser.update({ where: { id: admin.id }, data: { mustChangePassword: true, lastLoginAt: new Date() } });
  await logActivity(admin.id, "OTP_LOGIN", "Parol tiklash kodi bilan tizimga kirdi — yangi parol o'rnatishi kerak", ip);
  return { ok: true, admin: updated };
}

/** Parol almashtirilgach qolgan (ishlatilmagan) kodlar bekor qilinadi */
export async function revokeOtps(adminId: number): Promise<void> {
  await prisma.adminOtp.updateMany({ where: { adminId, usedAt: null }, data: { usedAt: new Date() } });
}
