import { useEffect, useState } from "react";
import { Copy, CreditCard, X } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { fmtDateTime, fmtSum, fullName } from "../lib/format";
import { useToast } from "../context/ToastContext";
import type { Paged, TelegramUser } from "../lib/types";
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

type Person = Pick<TelegramUser, "id" | "firstName" | "lastName" | "username" | "phone" | "isBlocked">;

const digits = (v: string) => v.replace(/\D/g, "");
const groupThousands = (v: string) => digits(v).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** Kimga: ism, telefon, username yoki Telegram ID bo'yicha qidirib tanlash */
function PersonPicker({ value, onChange }: { value: Person | null; onChange: (p: Person | null) => void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Telefon bo'shliq/qavs bilan yozilsa ham topilsin: "99 700-66-62" → "997006662"
    const term = /^[\d\s()+-]+$/.test(q.trim()) ? q.replace(/[^\d]/g, "") : q.trim();
    if (term.length < 2) {
      setItems([]);
      return;
    }
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .get<Paged<Person>>("/telegram-users", { params: { q: term, pageSize: 8 } })
        .then((r) => alive && setItems(r.data.items))
        .catch(() => alive && setItems([]))
        .finally(() => alive && setLoading(false));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
        <div className="min-w-0">
          <div className="truncate font-medium text-gray-900">{fullName(value)}</div>
          <div className="truncate text-xs text-gray-500">
            {[value.phone, value.username && `@${value.username}`].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
        <button type="button" className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700" onClick={() => onChange(null)} aria-label="Boshqa odamni tanlash">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }
  return (
    <div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ism, telefon yoki @username" autoFocus />
      {q.trim().length >= 2 && (
        <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-gray-200">
          {loading && items.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-500">Qidirilmoqda…</div>
          ) : items.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-500">Topilmadi</div>
          ) : (
            items.map((u) => (
              <button
                type="button"
                key={u.id}
                className="block w-full border-b border-gray-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-gray-50"
                onClick={() => onChange(u)}
              >
                <span className="font-medium text-gray-900">{fullName(u)}</span>
                <span className="ml-2 text-xs text-gray-500">
                  {[u.phone, u.username && `@${u.username}`].filter(Boolean).join(" · ")}
                  {u.isBlocked && " · botni bloklagan"}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * «To'lov havolasi»: kurs va narx tanlanadi — bot foydalanuvchiga shu summa bilan Click / Payme tugmalarini yuboradi.
 * To'lansa, buyurtma avtomatik tasdiqlanadi va kanal havolasi boradi.
 */
export function PayLinkButton({ user, onSent }: { user?: Person; onSent?: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState<Person | null>(user ?? null);
  const [products, setProducts] = useState<PayProduct[]>([]);
  const [productId, setProductId] = useState<number | "">("");
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState("7");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PayLinkResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setPerson(user ?? null);
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
  const valid = !!person && productId !== "" && sum >= 1000 && dayNum >= 1 && dayNum <= 30;

  const send = async () => {
    if (!person) return;
    setBusy(true);
    try {
      const r = await api.post<PayLinkResult>(`/telegram-users/${person.id}/pay-link`, { productId, amount: sum, days: dayNum });
      setResult(r.data);
      if (r.data.delivered) toast.success("To'lov havolasi yuborildi");
      else toast.error("Yetkazilmadi: foydalanuvchi botni bloklagan. Havolani o'zingiz yuborishingiz mumkin");
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
              Bot {person ? fullName(person) : "tanlangan odam"}ga «darslik uchun to'lov havolasi» xabarini Click va Payme tugmalari bilan yuboradi. To'lovdan keyin
              darslik avtomatik ochiladi.
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}
