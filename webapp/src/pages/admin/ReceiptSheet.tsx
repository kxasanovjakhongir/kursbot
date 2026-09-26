import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { useSession } from "../../context/SessionContext";
import { useToast } from "../../context/ToastContext";
import { useAction } from "../../hooks/useAction";
import { errorText } from "../../i18n";
import { api } from "../../lib/api";
import { fmtDateTime, fmtNumber, fullName } from "../../lib/format";
import { confirmDialog } from "../../lib/telegram";
import type { PendingReceipt, RejectReason } from "../../lib/types";
import { Money } from "../../components/Money";
import { Badge, Button, Row, Section, Sheet, Skeleton } from "../../components/ui";

/** Chek fayli himoyalangan (token bilan) — blob URL orqali ko'rsatiladi */
function ReceiptFile({ orderId, isPdf }: { orderId: string; isPdf: boolean }) {
  const { t } = useSession();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked = false;
    let created: string | null = null;
    api
      .blobUrl(`/admin/receipts/${orderId}/file`)
      .then((u) => {
        created = u;
        if (!revoked) setUrl(u);
      })
      .catch(() => setFailed(true));
    return () => {
      revoked = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [orderId]);

  if (failed) return <p className="rounded-2xl bg-section p-4 text-center text-[14px] text-hint">{t("error_title")}</p>;
  if (!url) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (isPdf) {
    return (
      <Button variant="secondary" block onClick={() => window.open(url, "_blank", "noopener")}>
        <FileText className="h-5 w-5" /> {t("open_pdf")}
      </Button>
    );
  }
  return <img src={url} alt="" className="max-h-[50vh] w-full rounded-2xl bg-section object-contain" />;
}

interface Props {
  receipt: PendingReceipt | null;
  reasons: RejectReason[];
  onClose: () => void;
  onDone: () => void;
}

/** Chekni ko'rib chiqish: tasdiqlash (tasdiq so'raladi) yoki sabab bilan rad etish */
export function ReceiptSheet({ receipt, reasons, onClose, onDone }: Props) {
  const { t, lang } = useSession();
  const toast = useToast();
  const [rejecting, setRejecting] = useState<RejectReason | null>(null);
  const [showReasons, setShowReasons] = useState(false);
  const [input, setInput] = useState("");

  useEffect(() => {
    setShowReasons(false);
    setRejecting(null);
    setInput("");
  }, [receipt?.orderId]);

  const [approve, approving] = useAction(async () => {
    if (!receipt || !(await confirmDialog(t("approve_confirm", { id: receipt.orderId })))) return;
    try {
      await api.post(`/admin/orders/${receipt.orderId}/approve`);
      toast.success(t("approved_ok"));
      onDone();
    } catch (err) {
      toast.error(errorText(t, err));
      onDone();
    }
  });

  const [reject, rejectBusy] = useAction(async (reason: RejectReason) => {
    if (!receipt) return;
    const body: { reason: string; amount?: number; text?: string } = { reason: reason.code };
    if (reason.code === "short") body.amount = Number(input.replace(/\D/g, ""));
    if (reason.code === "other") body.text = input.trim();
    try {
      await api.post(`/admin/orders/${receipt.orderId}/reject`, body);
      toast.success(t("rejected_ok"));
      onDone();
    } catch (err) {
      toast.error(errorText(t, err));
    }
  });

  const pick = (r: RejectReason) => {
    if (r.needsInput) {
      setRejecting(r);
      setInput("");
    } else reject(r);
  };

  const inputValid = rejecting?.code === "short" ? Number(input.replace(/\D/g, "")) > 0 : input.trim().length > 0;

  return (
    <Sheet open={!!receipt} onClose={onClose} title={receipt ? `#${receipt.orderId} · ${receipt.product.title}` : undefined}>
      {receipt && (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {receipt.receipt?.isDuplicate && <Badge tone="red">{t("duplicate")}</Badge>}
            {receipt.attempts > 1 && <Badge tone="yellow">{t("attempt_n", { n: receipt.attempts })}</Badge>}
            {receipt.shortfall && <Badge tone="yellow">{t("shortfall_prev", { sum: `${fmtNumber(receipt.shortfall)} ${t("sum")}` })}</Badge>}
            {receipt.user.isForeign && <Badge tone="gray">{t("foreign")}</Badge>}
          </div>

          <div className="mb-4">
            <ReceiptFile orderId={receipt.orderId} isPdf={receipt.receipt?.fileType === "pdf"} />
          </div>

          <Section>
            <Row title={t("amount")} after={<Money amount={receipt.amount} className="font-semibold text-text" />} />
            <Row title={fullName(receipt.user)} subtitle={[receipt.user.username && `@${receipt.user.username}`, receipt.user.phone].filter(Boolean).join(" · ")} />
            {receipt.receipt && <Row title={t("status_receipt_sent")} after={fmtDateTime(receipt.receipt.createdAt, lang)} />}
          </Section>

          {rejecting ? (
            <div className="space-y-3">
              <label className="block px-1 text-[14px] text-hint">{rejecting.code === "short" ? t("reject_amount") : t("reject_text")}</label>
              <input
                autoFocus
                inputMode={rejecting.code === "short" ? "numeric" : "text"}
                maxLength={rejecting.code === "short" ? 12 : 500}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="w-full rounded-xl bg-section px-4 py-3 text-[16px] outline-none ring-accent focus:ring-2"
              />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => setRejecting(null)}>
                  {t("back")}
                </Button>
                <Button variant="destructive" disabled={!inputValid} loading={rejectBusy} onClick={() => reject(rejecting)}>
                  {t("reject")}
                </Button>
              </div>
            </div>
          ) : showReasons ? (
            <Section title={t("reject_title")}>
              {reasons.map((r) => (
                <Row key={r.code} title={r.label} onClick={() => pick(r)} />
              ))}
            </Section>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="destructive" disabled={approving} onClick={() => setShowReasons(true)}>
                {t("reject")}
              </Button>
              <Button loading={approving} disabled={rejectBusy} onClick={approve}>
                {t("approve")}
              </Button>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
