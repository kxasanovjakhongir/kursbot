import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, Clock3, Copy, FileUp, XCircle } from "lucide-react";
import { useSession } from "../context/SessionContext";
import { useToast } from "../context/ToastContext";
import { useAction } from "../hooks/useAction";
import { useBackButton } from "../hooks/useBackButton";
import { invalidate, useQuery } from "../hooks/useQuery";
import { errorText } from "../i18n";
import { api } from "../lib/api";
import { fmtDateTime, fmtNumber, groupCard } from "../lib/format";
import { confirmDialog, openTelegramLink } from "../lib/telegram";
import type { OrderDetail } from "../lib/types";
import { Money } from "../components/Money";
import { OrderStatusBadge } from "../components/OrderStatus";
import { Async, Button, Page, Section, Skeleton } from "../components/ui";

const ACCEPT = "image/jpeg,image/png,application/pdf";

function Notice({ tone, icon, title, text }: { tone: "info" | "success" | "error"; icon: React.ReactNode; title: string; text?: string }) {
  const color = tone === "success" ? "text-emerald-600 dark:text-emerald-400" : tone === "error" ? "text-destructive" : "text-accent";
  return (
    <div className="mb-5 flex gap-3 rounded-2xl bg-section p-4">
      <span className={`mt-0.5 shrink-0 ${color}`}>{icon}</span>
      <div>
        <p className="font-semibold">{title}</p>
        {text && <p className="mt-0.5 whitespace-pre-line text-[14px] text-hint">{text}</p>}
      </div>
    </div>
  );
}

/** Buyurtma: to'lov ma'lumoti, chek yuklash, holat va bekor qilish */
export default function OrderPage() {
  useBackButton("/orders");
  const { id = "" } = useParams();
  const { t, lang, me } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [offHours, setOffHours] = useState<string | null>(null);
  const state = useQuery(`order:${id}`, () => api.get<OrderDetail>(`/orders/${encodeURIComponent(id)}`));

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("copied"));
    } catch {
      toast.error(t("error_generic"));
    }
  };

  const [upload, uploading] = useAction(async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await api.upload<{ working: boolean; workStart: string }>(`/orders/${encodeURIComponent(id)}/receipt`, form);
      setOffHours(res.working ? null : res.workStart);
      toast.success(t("receipt_sent_title"));
      invalidate("orders");
      state.reload();
    } catch (err) {
      toast.error(errorText(t, err));
      state.reload();
    }
  });

  const [cancel, cancelling] = useAction(async () => {
    if (!(await confirmDialog(t("cancel_confirm", { id })))) return;
    try {
      await api.post(`/orders/${encodeURIComponent(id)}/cancel`);
      toast.success(t("order_cancelled"));
      invalidate("orders");
      state.reload();
    } catch (err) {
      toast.error(errorText(t, err));
    }
  });

  const skeleton = (
    <div className="space-y-4">
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="h-40 w-full rounded-2xl" />
    </div>
  );

  return (
    <Page title={t("order_title", { id })}>
      <Async state={state} skeleton={skeleton}>
        {(o) => (
          <>
            <div className="mb-5 rounded-2xl bg-section p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[17px] font-semibold">{o.product.title}</p>
                <OrderStatusBadge status={o.status} />
              </div>
              <p className="mt-1 text-[13px] text-hint">{t("amount")}</p>
              <Money amount={o.amount} className="text-[26px] font-bold" />
            </div>

            {o.status === "receipt_sent" && (
              <Notice
                tone="info"
                icon={<Clock3 className="h-5 w-5" />}
                title={offHours ? t("receipt_sent_title") : t("status_receipt_sent")}
                text={offHours ? t("receipt_offhours", { time: offHours }) : t("review_text")}
              />
            )}
            {(o.status === "approved" || o.status === "joined") && (
              <>
                <Notice tone="success" icon={<CheckCircle2 className="h-5 w-5" />} title={t("approved_title")} text={t("approved_text")} />
                <Button block onClick={() => navigate("/orders")}>
                  {t("go_to_purchases")}
                </Button>
              </>
            )}
            {o.status === "rejected" && (
              <Notice
                tone="error"
                icon={<XCircle className="h-5 w-5" />}
                title={t("status_rejected")}
                text={[o.rejectReason ? t("rejected_reason", { reason: o.rejectReason }) : "", o.shortfall ? t("shortfall", { sum: `${fmtNumber(o.shortfall)} ${t("sum")}` }) : ""]
                  .filter(Boolean)
                  .join("\n")}
              />
            )}
            {!o.canPay && ["expired", "cancelled"].includes(o.status) && <Notice tone="info" icon={<Clock3 className="h-5 w-5" />} title={t("closed_text")} />}

            {o.canPay && o.card && (
              <Section title={t("pay_title")} footer={t("deadline", { date: fmtDateTime(o.expiresAt, lang) })}>
                <div className="p-4">
                  <ol className="mb-4 space-y-1.5 text-[15px]">
                    <li>1. {t("pay_step1", { sum: `${fmtNumber(o.amount)} ${t("sum")}` })}</li>
                    <li>2. {t("pay_step2")}</li>
                  </ol>
                  <p className="text-[13px] text-hint">{t("card_label")}</p>
                  <button
                    type="button"
                    onClick={() => void copy(o.card!.number)}
                    className="mt-1 flex w-full items-center justify-between rounded-xl bg-secondary px-3.5 py-3 text-left active:opacity-70"
                  >
                    <span className="font-mono text-[18px] font-semibold tracking-wide">{groupCard(o.card.number)}</span>
                    <span className="flex items-center gap-1 text-[14px] text-accent">
                      <Copy className="h-4 w-4" /> {t("copy")}
                    </span>
                  </button>
                  <p className="mt-3 text-[13px] text-hint">{t("holder_label")}</p>
                  <p className="text-[15px]">
                    {o.card.holder}
                    {o.card.bank ? ` · ${o.card.bank}` : ""}
                  </p>
                </div>
              </Section>
            )}

            {o.canUploadReceipt && (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  accept={ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) upload(file);
                  }}
                />
                <Button block loading={uploading} onClick={() => fileInput.current?.click()}>
                  {!uploading && <FileUp className="h-5 w-5" />}
                  {uploading ? t("receipt_uploading") : t("receipt_upload")}
                </Button>
                <p className="mt-2 text-center text-[13px] text-hint">
                  {t("receipt_hint")} · {t("attempts", { n: o.attempts, max: o.maxAttempts })}
                </p>
              </>
            )}

            {o.canCancel && (
              <Button variant="destructive" block className="mt-3" loading={cancelling} onClick={cancel}>
                {t("cancel_order")}
              </Button>
            )}

            {me().app.supportUrl && (o.status === "rejected" || o.status === "receipt_sent") && (
              <Button variant="plain" block className="mt-2" onClick={() => openTelegramLink(me().app.supportUrl!)}>
                {t("contact_admin")}
              </Button>
            )}
          </>
        )}
      </Async>
    </Page>
  );
}
