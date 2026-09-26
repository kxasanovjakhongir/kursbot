import { useEffect, useState } from "react";
import { Search, UserRound } from "lucide-react";
import { useSession } from "../../context/SessionContext";
import { useToast } from "../../context/ToastContext";
import { useAction } from "../../hooks/useAction";
import { useQuery } from "../../hooks/useQuery";
import { errorText, type MessageKey } from "../../i18n";
import { api } from "../../lib/api";
import { fmtDateTime, fmtNumber, formatPhone, fullName } from "../../lib/format";
import { confirmDialog } from "../../lib/telegram";
import type { AdminUser, Paged, PendingReceipt, RejectReason, Stats } from "../../lib/types";
import { Money } from "../../components/Money";
import { Async, Badge, Button, EmptyState, ListSkeleton, Page, Row, Section, Segmented, Sheet, Stat } from "../../components/ui";
import { ReceiptSheet } from "./ReceiptSheet";

type Tab = "dashboard" | "receipts" | "users";

function Dashboard() {
  const { t } = useSession();
  const state = useQuery("admin:stats", () => api.get<Stats>("/admin/stats"));
  return (
    <Async state={state} skeleton={<ListSkeleton rows={3} />}>
      {(s) => (
        <div className="grid grid-cols-2 gap-2.5">
          <Stat label={t("stat_users")} value={fmtNumber(s.users.total)} />
          <Stat label={t("stat_new_today")} value={fmtNumber(s.users.newToday)} tone="accent" />
          <Stat label={t("stat_active30")} value={fmtNumber(s.users.active30d)} />
          <Stat label={t("stat_blocked")} value={fmtNumber(s.users.blocked)} tone="destructive" />
          <Stat label={t("stat_orders_today")} value={fmtNumber(s.sales.ordersToday)} />
          <Stat label={t("stat_pending")} value={fmtNumber(s.sales.pendingReceipts)} tone={s.sales.pendingReceipts > 0 ? "accent" : undefined} />
          <Stat label={t("stat_revenue_today")} value={<Money amount={s.sales.revenueToday} className="text-[16px]" />} />
          <Stat label={t("stat_revenue_month")} value={<Money amount={s.sales.revenueMonth} className="text-[16px]" />} />
        </div>
      )}
    </Async>
  );
}

function Receipts() {
  const { t, lang } = useSession();
  const state = useQuery("admin:receipts", () => api.get<{ items: PendingReceipt[]; reasons: RejectReason[] }>("/admin/receipts"));
  const [open, setOpen] = useState<PendingReceipt | null>(null);

  return (
    <>
      <Async state={state}>
        {({ items }) =>
          items.length === 0 ? (
            <EmptyState title={t("receipts_empty")} />
          ) : (
            <Section>
              {items.map((r) => (
                <Row
                  key={r.orderId}
                  title={`#${r.orderId} · ${r.product.title}`}
                  subtitle={
                    <>
                      {fullName(r.user)} · <Money amount={r.amount} />
                      {r.receipt && ` · ${fmtDateTime(r.receipt.createdAt, lang)}`}
                    </>
                  }
                  after={r.receipt?.isDuplicate ? <Badge tone="red">{t("duplicate")}</Badge> : r.attempts > 1 ? <Badge tone="yellow">{r.attempts}</Badge> : undefined}
                  onClick={() => setOpen(r)}
                />
              ))}
            </Section>
          )
        }
      </Async>
      <ReceiptSheet
        receipt={open}
        reasons={state.data?.reasons ?? []}
        onClose={() => setOpen(null)}
        onDone={() => {
          setOpen(null);
          state.reload();
        }}
      />
    </>
  );
}

const USER_STATUS: { key: MessageKey; tone: "green" | "yellow" | "red" }[] = [
  { key: "user_active", tone: "green" },
  { key: "user_blocked", tone: "yellow" },
  { key: "user_banned", tone: "red" },
];
const statusOf = (u: AdminUser) => USER_STATUS[u.isBanned ? 2 : u.isBlocked ? 1 : 0];

function Users() {
  const { t, lang, can } = useSession();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<AdminUser | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(q.trim()), 350);
    return () => window.clearTimeout(id);
  }, [q]);

  const state = useQuery(`admin:users:${debounced}`, () =>
    api.get<Paged<AdminUser>>(`/admin/users?pageSize=30${debounced ? `&q=${encodeURIComponent(debounced)}` : ""}`).then((r) => r.items),
  );

  const [toggleBan, busy] = useAction(async (u: AdminUser) => {
    const name = fullName(u);
    if (!(await confirmDialog(t(u.isBanned ? "unban_confirm" : "ban_confirm", { name })))) return;
    try {
      const res = await api.post<{ isBanned: boolean }>(`/admin/users/${u.id}/${u.isBanned ? "unban" : "ban"}`);
      toast.success(t(res.isBanned ? "banned_ok" : "unbanned_ok"));
      state.setData((list) => list?.map((x) => (x.id === u.id ? { ...x, isBanned: res.isBanned } : x)) ?? null);
      setSelected(null);
    } catch (err) {
      toast.error(errorText(t, err));
    }
  });

  return (
    <>
      <label className="mb-3 flex items-center gap-2 rounded-xl bg-section px-3">
        <Search className="h-4 w-4 text-hint" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("users_search")}
          maxLength={100}
          className="w-full bg-transparent py-2.5 text-[16px] outline-none placeholder:text-hint"
        />
      </label>
      <Async state={state}>
        {(items) =>
          items.length === 0 ? (
            <EmptyState title={t("users_empty")} />
          ) : (
            <Section>
              {items.map((u) => {
                const s = statusOf(u);
                return (
                  <Row
                    key={u.id}
                    icon={<UserRound className="h-5 w-5 text-hint" />}
                    title={fullName(u)}
                    subtitle={[u.username && `@${u.username}`, u.phone].filter(Boolean).join(" · ") || u.telegramId}
                    after={<Badge tone={s.tone}>{t(s.key)}</Badge>}
                    onClick={() => setSelected(u)}
                  />
                );
              })}
            </Section>
          )
        }
      </Async>
      <Sheet open={!!selected} onClose={() => setSelected(null)} title={selected ? fullName(selected) : undefined}>
        {selected && (
          <>
            <Section>
              <Row title={t("telegram_id")} after={<span className="font-mono">{selected.telegramId}</span>} />
              <Row title={t("username")} after={selected.username ? `@${selected.username}` : t("not_set")} />
              <Row title={t("phone")} after={selected.phone ? formatPhone(selected.phone) : t("not_set")} />
              <Row title={t("joined_at")} after={fmtDateTime(selected.createdAt, lang)} />
            </Section>
            {can("users.manage") && (
              <Button variant={selected.isBanned ? "secondary" : "destructive"} block loading={busy} onClick={() => toggleBan(selected)}>
                {t(selected.isBanned ? "unban" : "ban")}
              </Button>
            )}
          </>
        )}
      </Sheet>
    </>
  );
}

/** Admin: faqat ruxsat berilgan bo'limlar ko'rinadi (backend ham har bir so'rovda tekshiradi) */
export default function AdminPage() {
  const { t, can } = useSession();
  const tabs: { value: Tab; label: string }[] = [
    ...(can("stats.view") ? [{ value: "dashboard" as const, label: t("adm_dashboard") }] : []),
    ...(can("orders.review") ? [{ value: "receipts" as const, label: t("adm_receipts") }] : []),
    ...(can("users.view") ? [{ value: "users" as const, label: t("adm_users") }] : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]?.value ?? "receipts");

  return (
    <Page title={t("admin_title")}>
      <Segmented value={tab} onChange={setTab} options={tabs} />
      {tab === "dashboard" && <Dashboard />}
      {tab === "receipts" && <Receipts />}
      {tab === "users" && <Users />}
    </Page>
  );
}
