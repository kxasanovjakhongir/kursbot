import { useEffect, useState } from "react";
import { Copy, Gift } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { fmtDateTime, fullName } from "../lib/format";
import { useToast } from "../context/ToastContext";
import { Button, Field, Input, Modal, Select } from "./ui";
import { PersonPicker, type PayProduct, type Person } from "./PayLinkButton";

interface TrialResult {
  delivered: boolean;
  expiresAt: string;
  links: { title: string; url: string }[];
}

const DAY_CHOICES = [1, 2, 3, 5, 7];

/**
 * «Sinov uchun ochish»: o'ylab turgan mijozga darslik kanali 1–7 kunga ochiladi.
 * Bot shaxsiy havola yuboradi — kanalga faqat shu odam qabul qilinadi. Muddat tugasa bot uni kanaldan
 * chiqaradi va «Darslikni olaman» (to'lov) tugmasini yuboradi. Sotib olsa — kirish doimiyga aylanadi.
 */
export function TrialButton({ user, onSent }: { user?: Person; onSent?: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState<Person | null>(user ?? null);
  const [products, setProducts] = useState<PayProduct[]>([]);
  const [productId, setProductId] = useState<number | "">("");
  const [days, setDays] = useState(2);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TrialResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setPerson(user ?? null);
    api
      .get<{ items: PayProduct[] }>("/telegram-users/pay-products")
      .then((r) => {
        setProducts(r.data.items);
        if (r.data.items[0] && productId === "") setProductId(r.data.items[0].id);
      })
      .catch((err) => toast.error(errorMessage(err)));
  }, [open]);

  const send = async () => {
    if (!person) return;
    setBusy(true);
    try {
      const r = await api.post<TrialResult>(`/telegram-users/${person.id}/trial`, { productId, days });
      setResult(r.data);
      if (r.data.delivered) toast.success("Sinov uchun ochildi — bot havolani yubordi");
      else toast.error("Yetkazilmadi: foydalanuvchi botni bloklagan. Havolani o'zingiz yuboring");
      onSent?.();
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
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Gift className="h-4 w-4" /> Sinov uchun ochish
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Darslikni sinov uchun ochish"
        footer={
          result ? (
            <Button onClick={() => setOpen(false)}>Yopish</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Bekor qilish
              </Button>
              <Button loading={busy} disabled={!person || productId === ""} onClick={() => void send()}>
                Ochib berish
              </Button>
            </>
          )
        }
      >
        {result ? (
          <div className="space-y-4 text-sm">
            <p className="text-gray-700">
              Kirish <b>{fmtDateTime(result.expiresAt)}</b> gacha ochildi.{" "}
              {result.delivered ? "Bot foydalanuvchiga kanal havolasini yubordi." : "Bot yetkaza olmadi — havolani o'zingiz yuboring."}
            </p>
            {result.links.map((l) => (
              <div key={l.url}>
                <div className="mb-1 text-xs font-medium text-gray-500">{l.title}</div>
                <div className="flex gap-2">
                  <Input readOnly value={l.url} onFocus={(e) => e.currentTarget.select()} />
                  <Button variant="secondary" size="sm" onClick={() => copy(l.url)} aria-label="Havolani nusxalash">
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
            <p className="text-xs text-gray-500">
              Havola faqat shu odam uchun: boshqa odam bossa ham kanalga qabul qilinmaydi. Muddat tugaganda bot uni kanaldan chiqaradi va sotib olish
              tugmasini yuboradi.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <Field label="Kimga">
              {user ? (
                <div className="text-sm font-medium text-gray-900">
                  {fullName(user)} {user.phone && <span className="font-normal text-gray-500">· {user.phone}</span>}
                </div>
              ) : (
                <PersonPicker value={person} onChange={setPerson} />
              )}
            </Field>
            <Field label="Kurs">
              <Select value={productId} onChange={(e) => setProductId(Number(e.target.value))}>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Necha kunga">
              <div className="flex flex-wrap gap-1.5">
                {DAY_CHOICES.map((d) => (
                  <Button key={d} size="sm" variant={d === days ? "primary" : "secondary"} onClick={() => setDays(d)}>
                    {d} kun
                  </Button>
                ))}
              </div>
            </Field>
            <p className="text-xs text-gray-500">
              Bot {person ? fullName(person) : "tanlangan odam"}ga yopiq kanalning shaxsiy havolasini yuboradi. {days} kundan keyin kanaldan avtomatik
              chiqariladi va «Darslikni olaman» tugmasi boradi. Sotib olsa — kirish doimiy bo'lib qoladi.
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}
