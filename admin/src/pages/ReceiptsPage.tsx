import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, RefreshCw, Search } from "lucide-react";
import { api } from "../lib/api";
import { fmtDateTime, fmtSum, fullName, ORDER_STATUS, timeAgo } from "../lib/format";
import type { Paged, PendingOrder, ReceiptHistoryItem } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { usePending } from "../context/PendingContext";
import { ReceiptFile } from "../components/ReceiptFile";
import { ReviewActions } from "../components/ReviewActions";
import { AsyncView, Badge, Button, Card, EmptyState, Input, PageHeader, Pagination, Select, Table, Td, Th } from "../components/ui";

type Tab = "pending" | "history";

export default function ReceiptsPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "history" ? "history" : "pending";
  const { count } = usePending();

  const tabCls = (t: Tab) =>
    `-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
      tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
    }`;

  return (
    <>
      <div className="mb-6 flex gap-1 border-b border-gray-200">
        <button className={tabCls("pending")} onClick={() => setParams({})}>
          Kutilayotgan{count > 0 && <span className="ml-2 rounded-full bg-red-500 px-2 py-0.5 text-xs font-semibold text-white">{count}</span>}
        </button>
        <button className={tabCls("history")} onClick={() => setParams({ tab: "history" })}>
          Tarix
        </button>
      </div>
      {tab === "pending" ? <PendingReceipts /> : <ReceiptsHistory />}
    </>
  );
}

function PendingReceipts() {
  const pending = usePending();
  const list = useAsync(
    () => api.get<Paged<PendingOrder>>("/orders", { params: { status: "receipt_sent", pageSize: 50 } }).then((r) => r.data),
    // Yangi chek kelsa ro'yxat o'zi yangilanadi
    [pending.latestReceiptId],
  );
  const done = () => {
    list.reload();
    pending.refresh();
  };

  return (
    <>
      <PageHeader
        title="Cheklar"
        subtitle="Tekshirilishi kerak bo'lgan to'lov cheklari. Tasdiqlash yoki rad etish Telegram'dagi kabi ishlaydi"
        action={
          <Button variant="secondary" onClick={done} loading={list.loading}>
            <RefreshCw className="h-4 w-4" /> Yangilash
          </Button>
        }
      />
      <AsyncView state={list}>
        {(d) =>
          d.items.length === 0 ? (
            <Card>
              <EmptyState title="Kutilayotgan cheklar yo'q ✅" hint="Yangi chek kelganda shu yerda va Telegram admin guruhida paydo bo'ladi" />
            </Card>
          ) : (
            <div className="grid gap-6 xl:grid-cols-2">
              {d.items.map((o) => {
                const receipt = o.receipts[0];
                return (
                  <Card key={o.id} className="overflow-hidden">
                    <div className="grid gap-0 sm:grid-cols-2">
                      <div className="border-b border-gray-100 bg-gray-50 p-3 sm:border-b-0 sm:border-r">
                        {receipt ? <ReceiptFile orderId={o.id} receiptId={receipt.id} type={receipt.fileType} className="max-h-80" /> : <p className="p-4 text-sm text-gray-500">Chek fayli yo'q</p>}
                      </div>
                      <div className="flex flex-col gap-4 p-5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Link to={`/orders/${o.id}`} className="font-semibold text-gray-900 hover:text-blue-600">
                            Buyurtma #{o.id}
                          </Link>
                          <span className="text-xs text-gray-500">{receipt ? timeAgo(receipt.createdAt) : ""}</span>
                        </div>
                        {(receipt?.isDuplicate || o.attempts > 1) && (
                          <div className="flex flex-wrap gap-2">
                            {receipt?.isDuplicate && (
                              <Badge tone="red">
                                <AlertTriangle className="h-3 w-3" /> DUBLIKAT chek
                              </Badge>
                            )}
                            {o.attempts > 1 && <Badge tone="yellow">Qayta urinish ({o.attempts}-chek)</Badge>}
                          </div>
                        )}
                        <dl className="space-y-1.5 text-sm">
                          <div className="flex justify-between gap-3">
                            <dt className="text-gray-500">Summa</dt>
                            <dd className="text-base font-semibold text-gray-900">{fmtSum(o.amount)}</dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-gray-500">Karta</dt>
                            <dd className="text-right text-gray-900">{o.card ? `${o.card.numberMasked} (${o.card.holder})` : "—"}</dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-gray-500">Mahsulot</dt>
                            <dd className="text-right text-gray-900">{o.product.title}</dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-gray-500">Mijoz</dt>
                            <dd className="text-right">
                              <Link to={`/telegram-users/${o.user.id}`} className="text-blue-600 hover:underline">
                                {fullName(o.user)}
                              </Link>
                              <div className="text-xs text-gray-500">{[o.user.username && `@${o.user.username}`, o.user.phone].filter(Boolean).join(" · ")}</div>
                            </dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-gray-500">Chek</dt>
                            <dd className="text-gray-900">{receipt ? fmtDateTime(receipt.createdAt) : "—"}</dd>
                          </div>
                        </dl>
                        <div className="mt-auto pt-2">
                          <ReviewActions orderId={o.id} amount={o.amount} onDone={done} />
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )
        }
      </AsyncView>
    </>
  );
}

const RESULTS = [
  { value: "all", label: "Barcha natijalar" },
  { value: "approved", label: "Tasdiqlangan" },
  { value: "rejected", label: "Rad etilgan" },
  { value: "cancelled", label: "Bekor qilingan" },
] as const;

/** Ko'rib chiqilgan cheklar — kim, qachon, qanday qaror qilgani bilan */
function ReceiptsHistory() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const result = params.get("result") ?? "all";
  const q = params.get("q") ?? "";
  const page = Number(params.get("page") ?? 1);
  const [search, setSearch] = useState(q);

  const list = useAsync(
    () => api.get<Paged<ReceiptHistoryItem>>("/orders/receipts/history", { params: { result, q: q || undefined, page } }).then((r) => r.data),
    [result, q, page],
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
      <PageHeader title="Cheklar tarixi" subtitle="Tasdiqlangan, rad etilgan va bekor qilingan cheklar. Qatorni bosing — chek rasmi va tafsilotlar" />
      <Card>
        <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row">
          <Select className="sm:w-56" value={result} onChange={(e) => set({ result: e.target.value === "all" ? "" : e.target.value })}>
            {RESULTS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
          <form onSubmit={onSearch} className="flex flex-1 gap-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buyurtma #, mijoz ismi, @username, telefon yoki kurs" />
            <Button type="submit" variant="secondary">
              <Search className="h-4 w-4" />
            </Button>
          </form>
        </div>
        <AsyncView state={list}>
          {(d) =>
            d.items.length === 0 ? (
              <EmptyState title="Cheklar topilmadi" hint={q || result !== "all" ? "Filtrni o'zgartirib ko'ring" : "Ko'rib chiqilgan cheklar shu yerda saqlanadi"} />
            ) : (
              <>
                <Table
                  head={
                    <tr>
                      <Th>#</Th>
                      <Th>Mijoz</Th>
                      <Th>Kurs</Th>
                      <Th>Summa</Th>
                      <Th>Natija</Th>
                      <Th className="hidden lg:table-cell">Ko'rib chiqqan</Th>
                      <Th className="hidden md:table-cell">Chek yuborilgan</Th>
                    </tr>
                  }
                >
                  {d.items.map((o) => {
                    const st = ORDER_STATUS[o.status];
                    const reviewer = o.cancelledBy?.name ?? (o.reviewedByPanel ? `${o.reviewedByPanel.name} (panel)` : (o.reviewedBy?.name ?? null));
                    const reviewedAt = o.cancelledAt ?? o.reviewedAt;
                    const note = o.cancelReason ?? (o.paidAt ? null : o.rejectReason);
                    return (
                      <tr key={o.id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/orders/${o.id}`)}>
                        <Td className="font-medium text-blue-600">#{o.id}</Td>
                        <Td className="whitespace-nowrap">
                          {fullName(o.user)}
                          <div className="text-xs text-gray-500">{o.user.phone ?? (o.user.username ? `@${o.user.username}` : "")}</div>
                        </Td>
                        <Td>{o.product.title}</Td>
                        <Td className="whitespace-nowrap tabular-nums">{fmtSum(o.amount)}</Td>
                        <Td>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge tone={st?.tone ?? "gray"}>{st?.label ?? o.status}</Badge>
                            {o.receipts.some((r) => r.isDuplicate) && <Badge tone="red">Dublikat</Badge>}
                            {o.receipts.length > 1 && <Badge tone="yellow">{o.receipts.length} ta chek</Badge>}
                          </div>
                          {note && <div className="mt-1 max-w-xs truncate text-xs text-gray-500" title={note}>{note}</div>}
                        </Td>
                        <Td className="hidden whitespace-nowrap text-gray-600 lg:table-cell">
                          {reviewer ?? "—"}
                          <div className="text-xs text-gray-500">{fmtDateTime(reviewedAt)}</div>
                        </Td>
                        <Td className="hidden whitespace-nowrap text-gray-500 md:table-cell">{fmtDateTime(o.receipts[0]?.createdAt)}</Td>
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
