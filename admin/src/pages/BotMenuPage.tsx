import { useEffect, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { api, errorMessage } from "../lib/api";
import type { MenuItem } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { AsyncView, Badge, Button, Card, ConfirmModal, EmptyState, Field, Input, Modal, PageHeader, Toggle } from "../components/ui";

interface FormState {
  id: number | null;
  name: string;
  command: string;
  description: string;
  isActive: boolean;
}
const EMPTY: FormState = { id: null, name: "", command: "", description: "", isActive: true };

export default function BotMenuPage() {
  const toast = useToast();
  const list = useAsync(() => api.get<{ items: MenuItem[] }>("/bot/menu").then((r) => r.data.items), []);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<MenuItem | null>(null);

  useEffect(() => {
    if (list.data) setItems(list.data);
  }, [list.data]);

  const move = async (index: number, dir: -1 | 1) => {
    const next = [...items];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    setItems(next);
    try {
      const r = await api.put<{ items: MenuItem[] }>("/bot/menu/reorder", { ids: next.map((i) => i.id) });
      setItems(r.data.items);
    } catch (err) {
      toast.error(errorMessage(err));
      list.reload();
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    const body = { name: form.name, command: form.command, description: form.description, isActive: form.isActive };
    try {
      if (form.id) await api.put(`/bot/menu/${form.id}`, body);
      else await api.post("/bot/menu", body);
      toast.success("Menyu yangilandi va Telegram'ga yuborildi");
      setForm(null);
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (m: MenuItem) => {
    try {
      await api.put(`/bot/menu/${m.id}`, { isActive: !m.isActive });
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    try {
      await api.delete(`/bot/menu/${toDelete.id}`);
      toast.success("O'chirildi");
      setToDelete(null);
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader
        title="Bot menyusi"
        subtitle="Telegram chatdagi «Menu» tugmasi. Tartib va o'zgarishlar darhol botga yuboriladi"
        action={
          <Button onClick={() => setForm(EMPTY)}>
            <Plus className="h-4 w-4" /> Qo'shish
          </Button>
        }
      />
      <Card>
        <AsyncView state={list}>
          {() =>
            items.length === 0 ? (
              <EmptyState title="Menyu bo'sh" />
            ) : (
              <ul className="divide-y divide-gray-100">
                {items.map((m, i) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
                    <div className="flex flex-col">
                      <button disabled={i === 0} onClick={() => void move(i, -1)} className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30" aria-label="Yuqoriga">
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button
                        disabled={i === items.length - 1}
                        onClick={() => void move(i, 1)}
                        className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                        aria-label="Pastga"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                    </div>
                    <span className="w-6 text-center text-sm tabular-nums text-gray-400">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-gray-900">{m.name}</span>
                        <span className="font-mono text-sm text-blue-600">/{m.command}</span>
                        {!m.isActive && <Badge tone="gray">O'chiq</Badge>}
                      </div>
                      <p className="truncate text-sm text-gray-500">{m.description}</p>
                    </div>
                    <Toggle checked={m.isActive} onChange={() => void toggle(m)} label="Faol" />
                    <Button variant="ghost" size="sm" onClick={() => setForm({ ...m })} aria-label="Tahrirlash">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setToDelete(m)} aria-label="O'chirish">
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </li>
                ))}
              </ul>
            )
          }
        </AsyncView>
      </Card>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? "Menyu elementini tahrirlash" : "Yangi menyu elementi"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              Bekor qilish
            </Button>
            <Button type="submit" form="menu-form" loading={saving}>
              Saqlash
            </Button>
          </>
        }
      >
        {form && (
          <form id="menu-form" onSubmit={save} className="space-y-4">
            <Field label="Nomi" hint="Panel uchun, masalan PROFILE">
              <Input required maxLength={64} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Buyruq" hint="Masalan: profile">
              <Input required maxLength={33} value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} />
            </Field>
            <Field label="Tavsif" hint="Telegram menyusida ko'rinadi">
              <Input required maxLength={256} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <div className="flex items-center gap-3">
              <Toggle checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label="Faol" />
              <span className="text-sm text-gray-700">Faol</span>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmModal
        open={!!toDelete}
        title="Menyudan o'chirish"
        danger
        confirmText="O'chirish"
        onClose={() => setToDelete(null)}
        onConfirm={() => void remove()}
        message={
          <>
            <b>/{toDelete?.command}</b> menyudan o'chirilsinmi?
          </>
        }
      />
    </>
  );
}
