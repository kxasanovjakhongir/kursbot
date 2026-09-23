import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { api, errorMessage } from "../lib/api";
import { fmtSum } from "../lib/format";
import type { RejectReason } from "../lib/types";
import { Button, ConfirmModal, Field, Input, Modal, Textarea } from "./ui";

let reasonsCache: RejectReason[] | null = null;

/** Chekni tasdiqlash / rad etish — Telegram'dagi tugmalar bilan bir xil natija */
export function ReviewActions({ orderId, amount, onDone }: { orderId: string; amount: number; onDone: () => void }) {
  const toast = useToast();
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reasons, setReasons] = useState<RejectReason[]>(reasonsCache ?? []);
  const [reason, setReason] = useState("");
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (reasonsCache) return;
    api.get<{ items: RejectReason[] }>("/orders/reject-reasons").then((r) => {
      reasonsCache = r.data.items;
      setReasons(r.data.items);
    }).catch(() => undefined);
  }, []);

  const approve = async () => {
    setBusy(true);
    try {
      await api.post(`/orders/${orderId}/approve`);
      toast.success(`#${orderId} tasdiqlandi — mijozga kanal linki yuborildi`);
      setApproveOpen(false);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
      setApproveOpen(false);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const selected = reasons.find((r) => r.code === reason);
  const reject = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const body =
        selected.code === "short" ? { reason: selected.code, amount: Number(extra.replace(/\D/g, "")) } : selected.code === "other" ? { reason: selected.code, text: extra } : { reason: selected.code };
      await api.post(`/orders/${orderId}/reject`, body);
      toast.success(`#${orderId} rad etildi — mijozga sabab yuborildi`);
      setRejectOpen(false);
      setReason("");
      setExtra("");
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setApproveOpen(true)} className="bg-green-600 hover:bg-green-700">
          <Check className="h-4 w-4" /> Tasdiqlash
        </Button>
        <Button variant="secondary" onClick={() => setRejectOpen(true)} className="text-red-600">
          <X className="h-4 w-4" /> Rad etish
        </Button>
      </div>

      <ConfirmModal
        open={approveOpen}
        title={`Buyurtma #${orderId}ni tasdiqlaysizmi?`}
        confirmText="Ha, tasdiqlash"
        loading={busy}
        onClose={() => setApproveOpen(false)}
        onConfirm={() => void approve()}
        message={
          <>
            Kartaga <b>{fmtSum(amount)}</b> tushganini tekshirdingizmi? Tasdiqlangach, mijozga yopiq kanalga shaxsiy link darhol yuboriladi.
          </>
        }
      />

      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={`Buyurtma #${orderId}ni rad etish`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejectOpen(false)} disabled={busy}>
              Bekor qilish
            </Button>
            <Button variant="danger" onClick={() => void reject()} loading={busy} disabled={!selected || (selected.needsInput && !extra.trim())}>
              Rad etish
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {reasons.map((r) => (
              <button
                key={r.code}
                type="button"
                onClick={() => {
                  setReason(r.code);
                  setExtra("");
                }}
                className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  reason === r.code ? "border-red-500 bg-red-50 text-red-700" : "border-gray-300 text-gray-700 hover:bg-gray-50"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          {selected?.code === "short" && (
            <Field label="Yetishmayotgan summa (so'm)" hint="Mijozga qolgan summani to'lash so'raladi">
              <Input inputMode="numeric" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="50000" autoFocus />
            </Field>
          )}
          {selected?.code === "other" && (
            <Field label="Mijozga boradigan sabab">
              <Textarea rows={3} maxLength={500} value={extra} onChange={(e) => setExtra(e.target.value)} autoFocus />
            </Field>
          )}
          <p className="text-xs text-gray-500">Sabab mijozga Telegram orqali yuboriladi.</p>
        </div>
      </Modal>
    </>
  );
}
