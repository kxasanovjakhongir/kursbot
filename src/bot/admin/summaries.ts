import type { Api } from "grammy";
import { prisma } from "../../db";
import { escapeHtml, formatSum } from "../../lib/format";
import { listCards } from "../../services/cards";
import { listAdmins } from "../../services/admins";
import { PAID_STATUSES } from "../../services/orders";

/** Telegram xabari 4096 belgigacha — ro'yxat oshsa qolgani "yana N ta" deb qisqartiriladi */
const MESSAGE_LIMIT = 4000;

export function fitBlocks(blocks: string[], sep: string, what: string): string {
  let out = "";
  for (let i = 0; i < blocks.length; i++) {
    const next = out ? `${out}${sep}${blocks[i]}` : blocks[i];
    const rest = blocks.length - i - 1;
    const tail = rest > 0 ? `\n\n… va yana ${rest} ta ${what} — to'liq ro'yxat admin panelda.` : "";
    if (next.length + tail.length > MESSAGE_LIMIT) {
      return `${out}\n\n… va yana ${blocks.length - i} ta ${what} — to'liq ro'yxat admin panelda.`;
    }
    out = next;
  }
  return out;
}

/** Admin buyruqlari ro'yxati (/admin → 📖 Buyruqlar) */
export const ADMIN_HELP = `<b>📖 Admin buyruqlari</b>

<b>Cheklar</b>
/pending — kutilayotgan cheklar (eng eskisi birinchi)
/order &lt;raqam&gt; — buyurtma holati

<b>Mahsulotlar</b> (super admin)
/products — ro'yxat va sozlamalar
/addproduct &lt;kod&gt; &lt;nomi&gt;
/setprice &lt;kod&gt; &lt;summa&gt;
/setoldprice &lt;kod&gt; &lt;summa|0&gt;
/settitle &lt;kod&gt; &lt;nomi&gt;
/setdesc &lt;kod&gt; &lt;tavsif&gt;
/setchannel &lt;kod&gt; &lt;kanal_id&gt;
/on &lt;kod&gt;, /off &lt;kod&gt; — faol/nofaol
Video: botga videoni yuboring va mahsulotni tanlang

<b>Kartalar</b> (super admin)
/cards, /addcard &lt;16 raqam&gt; &lt;egasi&gt;
/delcard &lt;id&gt;, /cardon &lt;id&gt;, /cardoff &lt;id&gt;

<b>Adminlar</b> (super admin)
/admins, /addadmin &lt;telegram_id&gt; [super], /deladmin &lt;telegram_id&gt; — yoki 🛠 Admin panel → 👥 Adminlar (tugmalar bilan)
/setgroup — admin guruhida yozing (cheklar shu guruhga keladi)`;

export async function productsSummary(api: Api): Promise<string> {
  const products = await prisma.product.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
  if (products.length === 0) return "Mahsulotlar yo'q. /addproduct bilan qo'shing.";
  const me = await api.getMe();
  const lines = products.map((p) =>
    [
      `<b>${escapeHtml(p.title)}</b> — <code>${p.code}</code> ${p.isActive ? "🟢" : "⚪️ nofaol"}`,
      `Narx: ${p.price > 0 ? formatSum(p.price) : "❗️ kiritilmagan"}${p.oldPrice ? ` (eski: ${formatSum(p.oldPrice)})` : ""}`,
      p.type === "bundle" ? `To'plam: ${p.bundleCodes.join(" + ")}` : `Kanal: ${p.channelId ? `<code>${p.channelId}</code>` : "❗️ kiritilmagan"}`,
      `Video: ${p.videoFileId ? "✅" : "—"}`,
      `Link: <code>https://t.me/${me.username}?start=${p.code}_bio</code>`,
    ].join("\n"),
  );
  return fitBlocks(lines, "\n\n", "mahsulot");
}

export async function cardsSummary(): Promise<string> {
  const cards = await listCards();
  if (cards.length === 0) return "Kartalar yo'q. /addcard bilan qo'shing.";
  const stats = await prisma.order.groupBy({
    by: ["cardId"],
    where: { status: { in: PAID_STATUSES }, paidAt: { gte: new Date(Date.now() - 30 * 86400_000) } },
    _sum: { amount: true },
  });
  const lines = cards.map((c) => {
    const sum = stats.find((s) => s.cardId === c.id)?._sum.amount ?? 0;
    return `#${c.id} ${c.numberMasked} — ${escapeHtml(c.holder)} ${c.isActive ? "🟢" : "⚪️"}\n30 kun tushum: ${formatSum(sum)}`;
  });
  return fitBlocks(lines, "\n\n", "karta");
}

export async function adminsSummary(): Promise<string> {
  const list = await listAdmins();
  if (list.length === 0) return "Adminlar yo'q.";
  return fitBlocks(
    list.map((a) => `${a.role === "superadmin" ? "⭐️" : "👤"} <code>${a.telegramId}</code> ${escapeHtml(a.name ?? "")}`),
    "\n",
    "admin",
  );
}
