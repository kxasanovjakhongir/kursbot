import { Link, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { api } from "../lib/api";
import { fmtDateTime, fmtSum, fullName, ORDER_STATUS } from "../lib/format";
import type { OrderDetail } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { AsyncView, Badge, Card, CardHeader, PageHeader } from "../components/ui";
import { ReceiptFile } from "../components/ReceiptFile";
import { ReviewActions } from "../components/ReviewActions";
import { CancelOrder } from "../components/CancelOrder";


const PAYMENT_METHOD_LABEL: Record<string, string> = { card: "Karta (chek)", payme: "Payme", click: "Click" };
const TX_STATE_LABEL: Record<number, string> = { 1: "kutilmoqda", 2: "to'langan", [-1]: "bekor qilingan", [-2]: "qaytarilgan" };

export default function OrderDetailPage() {
  const { id = "" } = useParams();
  const order = useAsync(() => api.get<OrderDetail>(`/orders/${id}`).then((r) => r.data), [id]);

  return (
    <>
      <Link to="/orders" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" /> Buyurtmalar
      </Link>
      <AsyncView state={order}>
        {(o) => (
          <>
            <PageHeader
              title={`Buyurtma #${o.id}`}
              subtitle={o.product.title}
              action={
                <div className="flex flex-wrap items-center gap-3">
                  <Badge tone={ORDER_STATUS[o.status]?.tone ?? "gray"}>{ORDER_STATUS[o.status]?.label ?? o.status}</Badge>
                  <CancelOrder orderId={o.id} status={o.status} onDone={order.reload} />
                </div>
              }
            />
            <div className="grid gap-6 lg:grid-cols-3">
              <Card>
                <CardHeader title="Tafsilotlar" />
                <dl className="space-y-3 p-5 text-sm">
                  {[
                    ["Mijoz", <Link key="u" to={`/telegram-users/${o.user.id}`} className="text-blue-600 hover:underline">{fullName(o.user)}</Link>],
                    ["Telefon", o.user.phone ?? "—"],
                    ["Summa", <b key="s">{fmtSum(o.amount)}</b>],
                    ["To'lov usuli", PAYMENT_METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod],
                    ["Karta", o.card ? `${o.card.numberMasked} (${o.card.holder})` : "—"],
                    ...(o.transactions?.length
                      ? [["Onlayn to'lov", o.transactions.map((t) => `${PAYMENT_METHOD_LABEL[t.provider]} #${t.externalId}: ${TX_STATE_LABEL[t.state] ?? t.state}`).join("; ")]]
                      : []),
                    ["Manba", o.source ?? "—"],
                    ["Urinishlar", o.attempts],
                    ["Ochilgan", fmtDateTime(o.createdAt)],
                    ["Muddat", fmtDateTime(o.expiresAt)],
                    ["To'langan", fmtDateTime(o.paidAt)],
                    ["Ko'rib chiqqan", o.paidAt && o.paymentMethod !== "card" ? `Avtomatik (${PAYMENT_METHOD_LABEL[o.paymentMethod]}), ${fmtDateTime(o.paidAt)}` : o.reviewedByPanel || o.reviewedBy?.name ? `${o.reviewedByPanel ? `${o.reviewedByPanel.name} (panel)` : o.reviewedBy?.name}, ${fmtDateTime(o.reviewedAt)}` : "—"],
                    ["Rad etish sababi", o.rejectReason ?? "—"],
                    ...(o.cancelledAt
                      ? [
                          ["Bekor qilgan", `${o.cancelledBy?.name ?? "—"}, ${fmtDateTime(o.cancelledAt)}`],
                          ["Bekor qilish sababi", o.cancelReason ?? "—"],
                        ]
                      : []),
                  ].map(([k, v]) => (
                    <div key={String(k)} className="flex justify-between gap-4">
                      <dt className="text-gray-500">{k}</dt>
                      <dd className="text-right text-gray-900">{v}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
              <Card className="lg:col-span-2">
                <CardHeader
                  title="Cheklar"
                  subtitle={o.receipts.length ? `${o.receipts.length} ta` : undefined}
                  action={o.status === "receipt_sent" ? <ReviewActions orderId={o.id} amount={o.amount} onDone={order.reload} /> : undefined}
                />
                <div className="space-y-6 p-5">
                  {o.receipts.length === 0 && <p className="text-sm text-gray-500">Chek yuborilmagan</p>}
                  {o.receipts.map((r, i) => (
                    <div key={r.id}>
                      <div className="mb-2 flex items-center gap-2 text-sm text-gray-600">
                        <span className="font-medium">{i + 1}-chek</span>· {fmtDateTime(r.createdAt)}
                        {r.isDuplicate && (
                          <Badge tone="red">
                            <AlertTriangle className="h-3 w-3" /> DUBLIKAT
                          </Badge>
                        )}
                      </div>
                      <ReceiptFile orderId={o.id} receiptId={r.id} type={r.fileType} />
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </>
        )}
      </AsyncView>
    </>
  );
}
