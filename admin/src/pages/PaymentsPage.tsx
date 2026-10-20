import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { FileSpreadsheet, Search, X } from "lucide-react";
import { api, downloadFile, errorMessage } from "../lib/api";
import { fmtDateTime, fmtNumber, fmtSum, fullName, ORDER_STATUS, TX_STATE } from "../lib/format";
import { PROVIDER_LABEL, reasonText, stateTime } from "../lib/payments";
import type { PaymentsPage as PaymentsData } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { useToast } from "../context/ToastContext";
import { AsyncView, Badge, Button, Card, EmptyState, Input, PageHeader, Pagination, Select, Table, Td, Th } from "../components/ui";

const SUMMARY: { state: "2" | "1" | "-1" | "-2"; tone: string }[] = [
  { state: "2", tone: "text-green-600" },
  { state: "1", tone: "text-amber-600" },
  { state: "-1", tone: "text-gray-600" },
  { state: "-2", tone: "text-red-600" },
];

/** Sana maydoni (brauzer vaqti, Toshkent) → kun boshi / keyingi kun boshi (ISO) */
const dayStart = (d: string) => new Date(`${d}T00:00:00`).toISOString();
const nextDayStart = (d: string) => new Date(new Date(`${d}T00:00:00`).getTime() + 86400_000).toISOString();

export default function PaymentsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const provider = params.get("provider") ?? "";
  const state = params.get("state") ?? "";
  const q = params.get("q") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const page = Number(params.get("page") ?? 1);
  const [search, setSearch] = useState(q);
  const [exporting, setExporting] = useState(false);

  /** Ro'yxat va Excel uchun bir xil filtr — Excel aynan ko'rinib turgan natija */
  const filter = {
    provider: provider || undefined,
    state: state || undefined,
    q: q || undefined,
    from: from ? dayStart(from) : undefined,
    to: to ? nextDayStart(to) : undefined,
  };

  const list = useAsync(() => api.get<PaymentsData>("/orders/payments", { params: { ...filter, page } }).then((r) => r.data), [provider, state, q, from, to, page]);

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in patch)) next.delete("page");
    setParams(next);
  };
  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    set({ q: search.trim() });
  };
  const hasFilters = !!(q || state || provider || from || to);
  const clearFilters = () => {
    setSearch("");
    setParams(new URLSearchParams());
  };

  const runExport = async () => {
    setExporting(true);
    try {
      await downloadFile("/orders/payments/export", filter, "payments.xlsx");
      toast.success("Fayl yuklab olindi");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Onlayn to'lovlar"
        subtitle="Payme va Click orqali qilingan barcha to'lovlar: kim, qaysi kursga, qancha, qaysi holatda. Qatorni bosing — to'liq ma'lumot"
        action={
          <Button variant="secondary" size="sm" loading={exporting} onClick={() => void runExport()} title="Joriy filtrlar bo'yicha yuklab olinadi">
            {!exporting && <FileSpreadsheet className="h-4 w-4" />} Excel
          </Button>
        }
      />

      <AsyncView state={list}>
        {(d) => (
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {SUMMARY.map((s) => {
              const v = d.summary[s.state];
              const active = state === s.state;
              return (
                <button
                  key={s.state}
                  type="button"
                  onClick={() => set({ state: active ? "" : s.state })}
                  className={`rounded-xl border bg-white p-4 text-left transition-colors hover:border-blue-300 ${active ? "border-blue-500 ring-1 ring-blue-500" : "border-gray-200"}`}
                >
                  <p className="text-sm text-gray-500">{TX_STATE[Number(s.state)].label}</p>
                  <p className={`mt-1 text-2xl font-semibold tabular-nums ${s.tone}`}>{fmtNumber(v.count)}</p>
                  <p className="mt-0.5 text-xs tabular-nums text-gray-500">{fmtSum(v.amount)}</p>
                </button>
              );
            })}
          </div>
        )}
      </AsyncView>

      <Card>
        <div className="space-y-3 border-b border-gray-100 p-4">
          <form onSubmit={onSearch} className="flex gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buyurtma #, tranzaksiya ID, Telegram ID, mijoz ismi, username, telefon yoki kurs"
            />
            <Button type="submit" variant="secondary" aria-label="Qidirish">
              <Search className="h-4 w-4" />
            </Button>
          </form>
          <div className="flex flex-col flex-wrap gap-3 sm:flex-row sm:items-center">
            <Select className="sm:w-44" value={provider} onChange={(e) => set({ provider: e.target.value })} aria-label="Tizim">
              <option value="">Payme va Click</option>
              <option value="click">Click</option>
              <option value="payme">Payme</option>
            </Select>
            <Select className="sm:w-48" value={state} onChange={(e) => set({ state: e.target.value })} aria-label="Holat">
              <option value="">Barcha holatlar</option>
              {SUMMARY.map((s) => (
                <option key={s.state} value={s.state}>
                  {TX_STATE[Number(s.state)].label}
                </option>
              ))}
            </Select>
            <div className="flex items-center gap-2">
              <Input type="date" className="sm:w-40" value={from} max={to || undefined} onChange={(e) => set({ from: e.target.value })} aria-label="Sanadan" />
              <span className="text-gray-400">—</span>
              <Input type="date" className="sm:w-40" value={to} min={from || undefined} onChange={(e) => set({ to: e.target.value })} aria-label="Sanagacha" />
            </div>
            {hasFilters && (
              <Button variant="secondary" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4" /> Tozalash
              </Button>
            )}
          </div>
        </div>
        <AsyncView state={list}>
          {(d) =>
            d.items.length === 0 ? (
              <EmptyState title="To'lovlar topilmadi" hint={hasFilters ? "Filtrni o'zgartirib ko'ring" : "Mijozlar Payme yoki Click orqali to'lashni boshlaganda shu yerda paydo bo'ladi"} />
            ) : (
              <>
                <Table
                  head={
                    <tr>
                      <Th>Tizim</Th>
                      <Th>Mijoz</Th>
                      <Th>Kurs</Th>
                      <Th>Summa</Th>
                      <Th>Holat</Th>
                      <Th className="hidden lg:table-cell">Tranzaksiya</Th>
                      <Th className="hidden md:table-cell">Vaqt</Th>
                    </tr>
                  }
                >
                  {d.items.map((t) => {
                    const st = TX_STATE[t.state];
                    const reason = reasonText(t);
                    const changed = stateTime(t);
                    const order = ORDER_STATUS[t.order.status];
                    return (
                      <tr key={t.id} className="cursor-pointer align-top hover:bg-gray-50" onClick={() => navigate(`/payments/${t.id}`)}>
                        <Td className="whitespace-nowrap">
                          <span className="font-medium text-gray-900">{PROVIDER_LABEL[t.provider]}</span>
                          <div className="text-xs text-gray-400">#{t.id}</div>
                          <Link to={`/orders/${t.order.id}`} onClick={(e) => e.stopPropagation()} className="text-xs text-blue-600 hover:underline">
                            Buyurtma #{t.order.id}
                          </Link>
                        </Td>
                        <Td className="whitespace-nowrap">
                          <Link to={`/telegram-users/${t.order.user.id}`} onClick={(e) => e.stopPropagation()} className="text-blue-600 hover:underline">
                            {fullName(t.order.user)}
                          </Link>
                          <div className="text-xs text-gray-500">{[t.order.user.phone, t.order.user.username && `@${t.order.user.username}`].filter(Boolean).join(" · ")}</div>
                          <div className="text-xs text-gray-400">ID {t.order.user.telegramId}</div>
                        </Td>
                        <Td>{t.order.product.title}</Td>
                        <Td className="whitespace-nowrap font-medium tabular-nums">{fmtSum(t.amount)}</Td>
                        <Td>
                          <Badge tone={st?.tone ?? "gray"}>{st?.label ?? t.state}</Badge>
                          {reason && <div className="mt-1 max-w-56 text-xs text-gray-500">{reason}</div>}
                          {t.state === 2 && t.order.paymentMethod !== t.provider && (
                            <div className="mt-1 max-w-56 text-xs text-red-600">Ortiqcha to'lov: buyurtma boshqa usulda to'langan</div>
                          )}
                          <div className="mt-1 text-xs text-gray-400">Buyurtma: {order?.label ?? t.order.status}</div>
                        </Td>
                        <Td className="hidden whitespace-nowrap text-xs text-gray-600 lg:table-cell">
                          <div className="font-mono">{t.externalId}</div>
                          {t.meta?.click_paydoc_id && <div className="text-gray-400">To'lov hujjati: {t.meta.click_paydoc_id}</div>}
                          {!!t.meta?.events?.length && <div className="text-gray-400">{t.meta.events.length} ta so'rov</div>}
                        </Td>
                        <Td className="hidden whitespace-nowrap text-xs text-gray-600 md:table-cell">
                          <div>Boshlangan: {fmtDateTime(t.createdAt)}</div>
                          {changed && (
                            <div className={t.state === 2 ? "text-green-700" : "text-gray-500"}>
                              {t.state === 2 ? "To'langan" : "Yopilgan"}: {fmtDateTime(changed)}
                            </div>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </Table>
                <Pagination page={d.page} pages={d.pages} total={d.total} onPage={(p) => set({ page: String(p) })} />
              </>
            )
          }
        </AsyncView>
      </Card>
    </>
  );
}
