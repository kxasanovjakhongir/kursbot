import { useState } from "react";
import { Ban } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { api, errorMessage } from "../lib/api";
import type { CancelResult, OrderStatus } from "../lib/types";
import { Button, Field, Modal, Textarea } from "./ui";

const OPEN: OrderStatus[] = ["new", "receipt_sent", "rejected"];
const PAID: OrderStatus[] = ["approved", "joined"];

export const canCancel = (status: OrderStatus) => OPEN.includes(status) || PAID.includes(status);

/**
 * Buyurtmani bekor qilish. Ochiq buyurtma — "Bekor qilingan"; to'langan — "Pul qaytarilgan" va mijoz
 * shu buyurtma bergan kanal(lar)dan chiqariladi. Ikkala holatda mijozga sabab bilan xabar boradi.
 */
export function CancelOrder({ orderId, status, onDone }: { orderId: string; status: OrderStatus; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (!canCancel(status)) return null;
  const paid = PAID.includes(status);

  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await api.post<CancelResult>(`/orders/${orderId}/cancel`, { reason: reason.trim() || undefined });
      toast.success(
        data.status === "refunded" ? `#${orderId} bekor qilindi — mijoz kanaldan chiqarildi va xabar oldi` : `#${orderId} bekor qilindi — mijozga xabar yuborildi`,
      );
      setOpen(false);
      setReason("");
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} className="text-red-600">
        <Ban className="h-4 w-4" /> Bekor qilish
      </Button>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={`Buyurtma #${orderId}ni bekor qilasizmi?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Yo'q
            </Button>
            <Button variant="danger" onClick={() => void submit()} loading={busy}>
              Ha, bekor qilish
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {paid ? (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              Bu buyurtma <b>to'langan</b>. Bekor qilinsa, holati «Pul qaytarilgan» bo'ladi va mijoz kurs kanalidan <b>chiqariladi</b>. Pulni qaytarishni o'zingiz
              amalga oshirasiz.
            </p>
          ) : (
            <p className="text-sm text-gray-600">Buyurtma yopiladi — mijoz unga chek yubora olmaydi. Kerak bo'lsa, mijoz qaytadan buyurtma bera oladi.</p>
          )}
          <Field label="Sabab (ixtiyoriy)" hint="Mijozga yuboriladigan xabarda ko'rsatiladi">
            <Textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Masalan: mijoz iltimosiga ko'ra" />
          </Field>
        </div>
      </Modal>
    </>
  );
}
