import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { api } from "../lib/api";
import { fmtDateTime, fmtNumber, fmtSum, fullName, ORDER_STATUS, TX_STATE } from "../lib/format";
import type { PaymentsPage as PaymentsData, PaymentTx } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { AsyncView, Badge, Button, Card, EmptyState, Input, PageHeader, Pagination, Select, Table, Td, Th } from "../components/ui";

const PROVIDER_LABEL: Record<PaymentTx["provider"], string> = { payme: "Payme", click: "Click" };

/** Payme bekor qilish sabablari (Merchant API, CancelTransaction.reason) */
const PAYME_REASON: Record<number, string> = {
  1: "Qabul qiluvchi topilmadi yoki faol emas",
  2: "Hisobdan yechishda xato",
  3: "Tranzaksiya bajarilmadi",
  4: "Vaqt tugadi",
  5: "Pul qaytarildi",
  10: "Noma'lum xato",
};

function reasonText(t: PaymentTx): string | null {
  if (t.reason === null) return t.state === -1 ? "Mijoz yangi urinish boshladi yoki to'lovni tashlab ketdi" : null;
  if (t.provider === "payme") return PAYME_REASON[t.reason] ?? `Payme sababi: ${t.reason}`;
  return `Click xato kodi: ${t.reason}`;
}

/** Holat o'zgargan vaqt: to'langan / bekor qilingan */
function stateTime(t: PaymentTx): string | null {
  if (t.state === 2) return t.performedAt;
  if (t.state < 0) return t.cancelledAt;
  return null;
}

const SUMMARY: { state: "2" | "1" | "-1" | "-2"; tone: string }[] = [
  { state: "2", tone: "text-green-600" },
  { state: "1", tone: "text-amber-600" },
  { state: "-1", tone: "text-gray-600" },
  { state: "-2", tone: "text-red-600" },
];

export default function PaymentsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const provider = params.get("provider") ?? "";
  const state = params.get("state") ?? "";
  const q = params.get("q") ?? "";
  const page = Number(params.get("page") ?? 1);
  const [search, setSearch] = useState(q);

  const list = useAsync(
    () =>
      api
        .get<PaymentsData>("/orders/payments", { params: { provider: provider || undefined, state: state || undefined, q: q || undefined, page } })
        .then((r) => r.data),
    [provider, state, q, page],
  );

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

  return (
    <>
      <PageHeader title="Onlayn to'lovlar" subtitle="Payme va Click orqali qilingan to'lovlar: kim, qaysi kursga, qancha va qaysi holatda. Qatorni bosing — buyurtma tafsilotlari" />

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
        <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row">
          <Select className="sm:w-44" value={provider} onChange={(e) => set({ provider: e.target.value })}>
            <option value="">Payme va Click</option>
            <option value="click">Click</option>
            <option value="payme">Payme</option>
          </Select>
          <Select className="sm:w-48" value={state} onChange={(e) => set({ state: e.target.value })}>
            <option value="">Barcha holatlar</option>
            {SUMMARY.map((s) => (
              <option key={s.state} value={s.state}>
                {TX_STATE[Number(s.state)].label}
              </option>
            ))}
          </Select>
          <form onSubmit={onSearch} className="flex flex-1 gap-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buyurtma #, tranzaksiya ID, mijoz ismi, telefon yoki kurs" />
            <Button type="submit" variant="secondary">
              <Search className="h-4 w-4" />
            </Button>
          </form>
        </div>
        <AsyncView state={list}>
          {(d) =>
            d.items.length === 0 ? (
              <EmptyState
                title="To'lovlar topilmadi"
                hint={q || state || provider ? "Filtrni o'zgartirib ko'ring" : "Mijozlar Payme yoki Click orqali to'lashni boshlaganda shu yerda paydo bo'ladi"}
              />
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
                      <tr key={t.id} className="cursor-pointer align-top hover:bg-gray-50" onClick={() => navigate(`/orders/${t.order.id}`)}>
                        <Td className="whitespace-nowrap">
                          <span className="font-medium text-gray-900">{PROVIDER_LABEL[t.provider]}</span>
                          <div className="text-xs text-blue-600">Buyurtma #{t.order.id}</div>
                        </Td>
                        <Td className="whitespace-nowrap">
                          <Link to={`/telegram-users/${t.order.user.id}`} onClick={(e) => e.stopPropagation()} className="text-blue-600 hover:underline">
                            {fullName(t.order.user)}
                          </Link>
                          <div className="text-xs text-gray-500">{[t.order.user.phone, t.order.user.username && `@${t.order.user.username}`].filter(Boolean).join(" · ")}</div>
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
