import { useState, type FormEvent } from "react";
import { CreditCard, Pencil, Plus, Trash2 } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { api, errorMessage } from "../lib/api";
import { fmtNumber, fmtSum } from "../lib/format";
import type { PaymentCard } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { AsyncView, Badge, Button, Card, ConfirmModal, EmptyState, Field, Input, Modal, PageHeader, Toggle } from "../components/ui";

interface FormState {
  id: number | null;
  number: string;
  holder: string;
  bank: string;
  isActive: boolean;
}

const groupCard = (s: string) =>
  s
    .replace(/\D/g, "")
    .slice(0, 16)
    .replace(/(.{4})/g, "$1 ")
    .trim();

export default function CardsPage() {
  const toast = useToast();
  const list = useAsync(() => api.get<{ items: PaymentCard[] }>("/cards").then((r) => r.data.items), []);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<PaymentCard | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    const body = { number: form.number, holder: form.holder, bank: form.bank, isActive: form.isActive };
    try {
      if (form.id) await api.put(`/cards/${form.id}`, body);
      else await api.post("/cards", body);
      toast.success("Karta saqlandi");
      setForm(null);
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (c: PaymentCard) => {
    try {
      await api.put(`/cards/${c.id}`, { isActive: !c.isActive });
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    try {
      await api.delete(`/cards/${toDelete.id}`);
      toast.success("Karta o'chirildi");
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setToDelete(null);
    }
  };

  const addButton = (
    <Button onClick={() => setForm({ id: null, number: "", holder: "", bank: "", isActive: true })}>
      <Plus className="h-4 w-4" /> Karta qo'shish
    </Button>
  );

  return (
    <>
      <PageHeader title="To'lov kartalari" subtitle="Mijoz «Darslikni olaman»ni bosganda faol kartalardan biri navbat bilan ko'rsatiladi" action={addButton} />
      <AsyncView state={list}>
        {(items) =>
          items.length === 0 ? (
            <Card>
              <EmptyState title="Kartalar yo'q" hint="Karta qo'shilmaguncha mijozlar to'lov ma'lumotini ololmaydi" action={addButton} />
            </Card>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((c) => (
                <Card key={c.id} className={c.isActive ? "" : "opacity-70"}>
                  <div className="rounded-t-xl bg-gradient-to-br from-blue-700 to-sidebar p-5 text-white">
                    <div className="flex items-center justify-between">
                      <CreditCard className="h-6 w-6 opacity-80" />
                      <span className="text-xs uppercase tracking-wide opacity-80">{c.bank ?? ""}</span>
                    </div>
                    <p className="mt-6 font-mono text-lg tracking-widest">{groupCard(c.number)}</p>
                    <p className="mt-2 text-sm uppercase opacity-90">{c.holder}</p>
                  </div>
                  <div className="space-y-3 p-5 text-sm">
                    <div className="flex items-center justify-between">
                      {c.isActive ? <Badge tone="green">Faol — mijozlarga ko'rsatiladi</Badge> : <Badge tone="gray">Nofaol</Badge>}
                      <Toggle checked={c.isActive} onChange={() => void toggle(c)} label="Faol" />
                    </div>
                    <p className="text-gray-600">
                      30 kun: <b className="text-gray-900">{fmtSum(c.revenue30d)}</b> · {fmtNumber(c.orders30d)} ta to'lov
                    </p>
                    <div className="flex justify-end gap-1 border-t border-gray-100 pt-3">
                      <Button variant="ghost" size="sm" onClick={() => setForm({ id: c.id, number: c.number, holder: c.holder, bank: c.bank ?? "", isActive: c.isActive })}>
                        <Pencil className="h-4 w-4" /> Tahrirlash
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setToDelete(c)} aria-label="O'chirish">
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )
        }
      </AsyncView>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? "Kartani tahrirlash" : "Yangi karta"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              Bekor qilish
            </Button>
            <Button type="submit" form="card-form" loading={saving}>
              Saqlash
            </Button>
          </>
        }
      >
        {form && (
          <form id="card-form" onSubmit={save} className="space-y-4">
            <Field label="Karta raqami" hint="16 ta raqam">
              <Input
                inputMode="numeric"
                required
                className="font-mono tracking-wider"
                value={groupCard(form.number)}
                onChange={(e) => setForm({ ...form, number: e.target.value.replace(/\D/g, "").slice(0, 16) })}
                placeholder="8600 1234 5678 9012"
              />
            </Field>
            <Field label="Karta egasi" hint="Mijozga ko'rsatiladi">
              <Input required minLength={2} maxLength={100} value={form.holder} onChange={(e) => setForm({ ...form, holder: e.target.value })} placeholder="Aziz Karimov" />
            </Field>
            <Field label="Bank (ixtiyoriy)">
              <Input maxLength={50} value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} placeholder="Uzcard / Humo" />
            </Field>
            <div className="flex items-center gap-3">
              <Toggle checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label="Faol" />
              <span className="text-sm text-gray-700">Faol (yangi buyurtmalarga beriladi)</span>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmModal
        open={!!toDelete}
        title="Kartani o'chirish"
        danger
        confirmText="O'chirish"
        onClose={() => setToDelete(null)}
        onConfirm={() => void remove()}
        message={
          <>
            <b>{toDelete?.numberMasked}</b> o'chirilsinmi? Eski buyurtmalardagi yozuv saqlanadi.
          </>
        }
      />
    </>
  );
}
