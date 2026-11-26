import { useEffect, useState } from "react";
import { Copy, CreditCard } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { fmtDateTime, fmtSum } from "../lib/format";
import { useToast } from "../context/ToastContext";
import type { TelegramUserDetail } from "../lib/types";
import { Button, Field, Input, Modal, Select } from "./ui";

interface PayProduct {
  id: number;
  title: string;
  price: number;
}

interface PayLinkResult {
  delivered: boolean;
  orderId: string;
  amount: number;
  expiresAt: string;
  clickUrl: string | null;
  paymeUrl: string | null;
}

const digits = (v: string) => v.replace(/\D/g, "");
const groupThousands = (v: string) => digits(v).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/**
 * «To'lov havolasi»: kurs va narx tanlanadi — bot foydalanuvchiga shu summa bilan Click / Payme tugmalarini yuboradi.
 * To'lansa, buyurtma avtomatik tasdiqlanadi va kanal havolasi boradi.
 */
export function PayLinkButton({ user, onSent }: { user: TelegramUserDetail; onSent: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState<PayProduct[]>([]);
  const [productId, setProductId] = useState<number | "">("");
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState("7");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PayLinkResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    api
      .get<{ items: PayProduct[] }>("/telegram-users/pay-products")
      .then((r) => {
        setProducts(r.data.items);
        const first = r.data.items[0];
        if (first && productId === "") {
          setProductId(first.id);
          setAmount(groupThousands(String(first.price)));
        }
      })
      .catch((err) => toast.error(errorMessage(err)));
  }, [open]);

  const pick = (id: number) => {
    setProductId(id);
    const p = products.find((x) => x.id === id);
    if (p) setAmount(groupThousands(String(p.price)));
  };

  const sum = Number(digits(amount));
  const dayNum = Number(days);
  const valid = productId !== "" && sum >= 1000 && dayNum >= 1 && dayNum <= 30;

  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post<PayLinkResult>(`/telegram-users/${user.id}/pay-link`, { productId, amount: sum, days: dayNum });
      setResult(r.data);
      if (r.data.delivered) toast.success("To'lov havolasi yuborildi");
      else toast.error("Yetkazilmadi: foydalanuvchi botni bloklagan. Havolani o'zingiz yuborishingiz mumkin");
      onSent();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => toast.success("Nusxalandi"),
      () => toast.error("Nusxalab bo'lmadi"),
    );
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <CreditCard className="h-4 w-4" /> To'lov havolasi
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="To'lov havolasi yuborish"
        footer={
          result ? (
            <Button onClick={() => setOpen(false)}>Yopish</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Bekor qilish
              </Button>
              <Button loading={busy} disabled={!valid} onClick={() => void send()}>
                Botdan yuborish
              </Button>
            </>
          )
        }
      >
        {result ? (
          <div className="space-y-4 text-sm">
            <p className="text-gray-700">
              Buyurtma <b>#{result.orderId}</b> · {fmtSum(result.amount)} · {fmtDateTime(result.expiresAt)} gacha.{" "}
              {result.delivered ? "Bot foydalanuvchiga Click va Payme tugmalarini yubordi." : "Bot yetkaza olmadi — havolani o'zingiz yuboring."}
            </p>
            {[
              ["Click", result.clickUrl],
              ["Payme", result.paymeUrl],
            ].map(([name, url]) =>
              url ? (
                <div key={name}>
                  <div className="mb-1 text-xs font-medium text-gray-500">{name}</div>
                  <div className="flex gap-2">
                    <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
                    <Button variant="secondary" size="sm" onClick={() => copy(url)} aria-label={`${name} havolasini nusxalash`}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : null,
            )}
            <p className="text-xs text-gray-500">To'lov tushishi bilan buyurtma avtomatik tasdiqlanadi va kanal havolasi boradi.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <Field label="Kurs">
              <Select value={productId} onChange={(e) => pick(Number(e.target.value))}>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Narx (so'm)" hint="Kursning joriy narxi qo'yilgan — istasangiz o'zgartiring. Mijoz aynan shu summani to'laydi">
              <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(groupThousands(e.target.value))} placeholder="1 800 000" />
            </Field>
            <Field label="Havola necha kun amal qiladi" hint="1–30 kun">
              <Input type="number" min={1} max={30} value={days} onChange={(e) => setDays(e.target.value)} />
            </Field>
            <p className="text-xs text-gray-500">
              Bot {user.firstName ?? "foydalanuvchi"}ga «darslik uchun to'lov havolasi» xabarini Click va Payme tugmalari bilan yuboradi. To'lovdan keyin
              darslik avtomatik ochiladi.
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}
