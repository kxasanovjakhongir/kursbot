import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, FileText } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { fmtDateTime, fmtSum, fullName, ORDER_STATUS } from "../lib/format";
import type { OrderDetail } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { AsyncView, Badge, Card, CardHeader, PageHeader, Spinner } from "../components/ui";

/** Chek fayli JWT bilan yuklanadi (img src sarlavha yubora olmaydi) */
function ReceiptFile({ orderId, receiptId, type }: { orderId: string; receiptId: string; type: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    api
      .get<Blob>(`/orders/${orderId}/receipts/${receiptId}/file`, { responseType: "blob" })
      .then((r) => {
        objectUrl = URL.createObjectURL(r.data);
        setUrl(objectUrl);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [orderId, receiptId]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!url) return <Spinner label="Chek yuklanmoqda…" />;
  if (type === "pdf")
    return (
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline">
        <FileText className="h-4 w-4" /> PDF chekni ochish
      </a>
    );
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt="To'lov cheki" className="max-h-[480px] rounded-lg border border-gray-200 object-contain" />
    </a>
  );
}

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
              action={<Badge tone={ORDER_STATUS[o.status]?.tone ?? "gray"}>{ORDER_STATUS[o.status]?.label ?? o.status}</Badge>}
            />
            <div className="grid gap-6 lg:grid-cols-3">
              <Card>
                <CardHeader title="Tafsilotlar" />
                <dl className="space-y-3 p-5 text-sm">
                  {[
                    ["Mijoz", <Link key="u" to={`/telegram-users/${o.user.id}`} className="text-blue-600 hover:underline">{fullName(o.user)}</Link>],
                    ["Telefon", o.user.phone ?? "—"],
                    ["Summa", <b key="s">{fmtSum(o.amount)}</b>],
                    ["Karta", o.card ? `${o.card.numberMasked} (${o.card.holder})` : "—"],
                    ["Manba", o.source ?? "—"],
                    ["Urinishlar", o.attempts],
                    ["Ochilgan", fmtDateTime(o.createdAt)],
                    ["Muddat", fmtDateTime(o.expiresAt)],
                    ["To'langan", fmtDateTime(o.paidAt)],
                    ["Ko'rib chiqqan", o.reviewedBy?.name ? `${o.reviewedBy.name}, ${fmtDateTime(o.reviewedAt)}` : "—"],
                    ["Rad etish sababi", o.rejectReason ?? "—"],
                  ].map(([k, v]) => (
                    <div key={String(k)} className="flex justify-between gap-4">
                      <dt className="text-gray-500">{k}</dt>
                      <dd className="text-right text-gray-900">{v}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
              <Card className="lg:col-span-2">
                <CardHeader title="Cheklar" subtitle={o.receipts.length ? `${o.receipts.length} ta` : undefined} />
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
