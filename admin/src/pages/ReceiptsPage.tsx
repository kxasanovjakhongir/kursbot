import { Link } from "react-router-dom";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { fmtDateTime, fmtSum, fullName, timeAgo } from "../lib/format";
import type { Paged, PendingOrder } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { usePending } from "../context/PendingContext";
import { ReceiptFile } from "../components/ReceiptFile";
import { ReviewActions } from "../components/ReviewActions";
import { AsyncView, Badge, Button, Card, EmptyState, PageHeader } from "../components/ui";

export default function ReceiptsPage() {
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
