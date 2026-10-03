/**
 * Admin kiritgan matn Telegram HTML (parse_mode: "HTML") sifatida yuboriladi. Noto'g'ri belgi yoki
 * yopilmagan teg bo'lsa Telegram xabarni umuman yubormaydi — shuning uchun saqlashdan oldin tekshiriladi.
 * https://core.telegram.org/bots/api#html-style
 */
const ALLOWED_TAGS = new Set(["b", "strong", "i", "em", "u", "ins", "s", "strike", "del", "code", "pre", "tg-spoiler", "blockquote", "a", "span"]);

const TOKEN_RE = /<(\/?)([a-zA-Z][a-zA-Z-]*)((?:\s+[a-zA-Z-]+(?:="[^"<>]*")?)*)\s*>|&(?:#\d+|#x[0-9a-fA-F]+|lt|gt|amp|quot);|[<>&]/g;

/** Xato matni (o'zbekcha) yoki null — matn yaroqli */
export function telegramHtmlError(text: string): string | null {
  const stack: string[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const [token, closing, rawName, attrs = ""] = m;
    if (token === "<" || token === ">" || token === "&") {
      return "«<», «>» va «&» belgilari o'rniga &lt; &gt; &amp; yozing (yoki HTML tegini to'g'ri yozing).";
    }
    if (!rawName) continue; // HTML entity
    const name = rawName.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return `<${name}> tegi Telegram'da qo'llab-quvvatlanmaydi. Ruxsat etilgan: <b>, <i>, <u>, <s>, <code>, <a href="...">.`;
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

/** Shablondagi {nom} o'zgaruvchilari */
export function templateVars(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}
