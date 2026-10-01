/**
 * Faylning haqiqiy turi — birinchi baytlari (magic bytes) bo'yicha. Klient yuborgan Content-Type
 * va fayl kengaytmasiga ishonilmaydi: .jpg deb nomlangan HTML/skript rad etiladi.
 */
export type SniffedType = "jpeg" | "png" | "webp" | "gif" | "pdf" | "mp4" | "webm";

const startsWith = (buf: Buffer, bytes: number[], offset = 0) => bytes.every((b, i) => buf[offset + i] === b);

export function sniffFileType(buf: Buffer): SniffedType | null {
  if (buf.length < 12) return null;
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return "gif";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buf.toString("ascii", 0, 5) === "%PDF-") return "pdf";
  // ISO BMFF (mp4/mov): 4-baytdan keyin "ftyp"
  if (buf.toString("ascii", 4, 8) === "ftyp") return "mp4";
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return "webm";
  return null;
}

/**
 * Foydalanuvchi bergan fayl nomi faqat Telegram'ga ko'rsatiladigan nom sifatida ishlatiladi
 * (diskka yozilmaydi). Baribir: yo'l qismlari, boshqaruv belgilari va uzun nomlar olib tashlanadi.
 */
export function safeFileName(name: string | undefined, fallback: string): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const clean = base
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .replace(/^\.+/, "")
    .slice(0, 80)
    .trim();
  return clean || fallback;
}
