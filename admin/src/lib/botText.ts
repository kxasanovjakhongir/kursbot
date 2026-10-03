import type { BotTextItem } from "./types";

/**
 * Bot matni tekshiruvi — backend dagi editableTextError bilan bir xil qoidalar
 * (yakuniy tekshiruv serverda; bu yerda — darhol ko'rsatish uchun).
 */
const ALLOWED_TAGS = new Set(["b", "strong", "i", "em", "u", "ins", "s", "strike", "del", "code", "pre", "tg-spoiler", "blockquote", "a", "span"]);
const TOKEN_RE = /<(\/?)([a-zA-Z][a-zA-Z-]*)((?:\s+[a-zA-Z-]+(?:="[^"<>]*")?)*)\s*>|&(?:#\d+|#x[0-9a-fA-F]+|lt|gt|amp|quot);|[<>&]/g;

function htmlError(text: string): string | null {
  const stack: string[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const [token, closing, rawName, attrs = ""] = m;
    if (token === "<" || token === ">" || token === "&") return "«<», «>» va «&» belgilari o'rniga &lt; &gt; &amp; yozing (yoki HTML tegini to'g'ri yozing).";
    if (!rawName) continue;
    const name = rawName.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return `<${name}> tegi Telegram'da qo'llab-quvvatlanmaydi.`;
    if (closing) {
      if (stack.pop() !== name) return `</${name}> tegi ochilmagan yoki noto'g'ri tartibda yopilgan.`;
      continue;
    }
    if (name === "a" && !/\bhref="[^"]+"/.test(attrs)) return `<a> tegida href="..." bo'lishi kerak.`;
    if (name === "span" && !/\bclass="tg-spoiler"/.test(attrs)) return `<span> faqat class="tg-spoiler" bilan ishlatiladi.`;
    stack.push(name);
  }
  return stack.length ? `<${stack.at(-1)}> tegi yopilmagan.` : null;
}

export function botTextError(item: BotTextItem, value: string): string | null {
  // Bo'sh matn — xabar (yoki xabar qismi) o'chiriladi
  if (!value.trim()) return null;
  if (value.length > item.max) return `Matn ${item.max} belgidan oshmasligi kerak.`;
  const used = [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  const unknown = used.find((v) => !item.vars.includes(v));
  if (unknown) {
    return `Noma'lum o'zgaruvchi {${unknown}}. ${item.vars.length ? `Ruxsat etilgan: ${item.vars.map((v) => `{${v}}`).join(", ")}.` : "Bu matnda o'zgaruvchi ishlatilmaydi."}`;
  }
  if (item.format === "popup") return /<[a-zA-Z/]/.test(value) ? "Bu oynada formatlash (HTML teglar) ishlamaydi." : null;
  return htmlError(value);
}

const PREVIEW_TAGS: Record<string, [string, string]> = {
  b: ["<b>", "</b>"],
  strong: ["<b>", "</b>"],
  i: ["<i>", "</i>"],
  em: ["<i>", "</i>"],
  u: ["<u>", "</u>"],
  ins: ["<u>", "</u>"],
  s: ["<s>", "</s>"],
  strike: ["<s>", "</s>"],
  del: ["<s>", "</s>"],
  code: ['<code class="rounded bg-gray-100 px-1 font-mono text-[13px]">', "</code>"],
  pre: ['<code class="block rounded bg-gray-100 p-2 font-mono text-[13px]">', "</code>"],
  blockquote: ['<span class="block border-l-2 border-blue-400 pl-2">', "</span>"],
  "tg-spoiler": ['<span class="rounded bg-gray-300 text-gray-300">', "</span>"],
  a: ['<span class="text-blue-600 underline">', "</span>"],
  span: ['<span class="rounded bg-gray-300 text-gray-300">', "</span>"],
};

/**
 * Ko'rinish (preview) uchun xavfsiz HTML: avval < va > to'liq escape qilinadi, keyin faqat
 * ruxsat etilgan teglar o'zimizning (atributsiz) teglarimizga almashtiriladi. Admin yozgan atributlar
 * (href va h.k.) sahifaga tushmaydi. {o'zgaruvchilar} ajratib ko'rsatiladi.
 */
export function previewHtml(text: string): string {
  const escaped = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped
    .replace(/&lt;(\/?)([a-zA-Z-]+)(?:\s[^&]*?)?&gt;/g, (m, closing: string, name: string) => {
      const tag = PREVIEW_TAGS[name.toLowerCase()];
      return tag ? tag[closing ? 1 : 0] : m;
    })
    .replace(/\{(\w+)\}/g, '<span class="rounded bg-blue-50 px-1 font-mono text-[13px] text-blue-700">{$1}</span>');
}

/** Tavsiya etilgan, lekin matnda yo'q o'zgaruvchilar (majburiy emas — ogohlantirish uchun) */
export function missingRecommendedVars(item: BotTextItem, value: string): string[] {
  if (!value.trim()) return [];
  const used = new Set([...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  return item.required.filter((v) => !used.has(v));
}
