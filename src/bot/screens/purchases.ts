import { InlineKeyboard } from "grammy";
import type { OrderStatus } from "@prisma/client";
import type { BotContext } from "../context";
import { withNav, withPagination } from "../keyboards";
import type { TextKey } from "../../i18n";
import { formatDate } from "../../lib/format";
import { listUserGrants } from "../../services/access";
import { expireStaleOrders, listOpenOrders } from "../../services/orders";
import { CB } from "../ui/callbacks";
import { paginate, type Screen } from "../ui/render";

const PAGE_SIZE = 6;

const ORDER_STATUS_KEY: Partial<Record<OrderStatus, TextKey>> = {
  new: "order_status_new",
  receipt_sent: "order_status_receipt_sent",
  rejected: "order_status_rejected",
};

interface Entry {
  line: string;
  button?: { text: string; data: string };
}

/** 🧾 Mening xaridlarim: olingan darsliklar (link olish) va ochiq buyurtmalar (to'lov ma'lumoti) */
export async function purchasesScreen(ctx: BotContext, page = 1): Promise<Screen> {
  const user = ctx.user!;
  await expireStaleOrders(user.id);
  const [grants, open] = await Promise.all([listUserGrants(user.id), listOpenOrders(user.id)]);

  if (grants.length === 0 && open.length === 0) {
    return {
      text: await ctx.t("purchases_empty"),
      keyboard: withNav(new InlineKeyboard().text(ctx.label("menu_products"), CB.catalog()), ctx.lang),
    };
  }

  const entries: Entry[] = [];
  for (const g of grants) {
    entries.push({
      line:
        (await ctx.t(g.joinedAt ? "purchase_joined" : "purchase_not_joined", { mahsulot: g.product.title })) +
        (g.expiresAt ? `\n${await ctx.t("purchase_until", { sana: formatDate(g.expiresAt) })}` : ""),
      button: { text: ctx.label("btn_get_link", { mahsulot: g.product.title }), data: CB.link(g.id) },
    });
  }
  for (const o of open) {
    const statusKey = ORDER_STATUS_KEY[o.status];
    entries.push({
      line: await ctx.t("order_line", {
        raqam: o.id.toString(),
        mahsulot: o.product.title,
        holat: statusKey ? await ctx.t(statusKey) : o.status,
      }),
      button: o.status === "receipt_sent" ? undefined : { text: ctx.label("btn_pay_info", { raqam: o.id.toString() }), data: CB.pay(o.id) },
    });
  }

  const p = paginate(entries, page, PAGE_SIZE);
  const kb = new InlineKeyboard();
  for (const e of p.items) if (e.button) kb.text(e.button.text, e.button.data).row();
  withPagination(kb, p.page, p.pages, CB.purchases);

  const header = await ctx.t("purchases_header");
  return { text: [header, "", ...p.items.map((e) => e.line)].join("\n"), keyboard: withNav(kb, ctx.lang) };
}
