export interface NormalizedPhone {
  phone: string;
  isForeign: boolean;
}

/** Raqamni +998XXXXXXXXX ko'rinishiga keltiradi (TZ 5.2). Chet el raqami "xorijiy" deb belgilanadi. */
export function normalizePhone(raw: string): NormalizedPhone {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("998")) {
    return { phone: `+${digits}`, isForeign: false };
  }
  if (digits.length === 9) {
    return { phone: `+998${digits}`, isForeign: false };
  }
  return { phone: `+${digits}`, isForeign: true };
}
