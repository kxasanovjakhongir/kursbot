export interface DeepLink {
  productCode: string | null;
  source: string;
}

/**
 * start parametri: <mahsulot>_<manba>, masalan "4b_reel12", "qd_bio", "bundle".
 * Telegram cheklovi: 64 belgi, A-Z a-z 0-9 _ - (TZ 5.1).
 */
export function parseStartPayload(payload: string | undefined | null): DeepLink {
  const p = (payload ?? "").trim();
  if (!p || p.length > 64 || !/^[A-Za-z0-9_-]+$/.test(p)) {
    return { productCode: null, source: "direct" };
  }
  const idx = p.indexOf("_");
  if (idx === -1) return { productCode: p.toLowerCase(), source: "unknown" };
  const productCode = p.slice(0, idx).toLowerCase();
  const source = p.slice(idx + 1).toLowerCase() || "unknown";
  return { productCode: productCode || null, source };
}
