import { useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { api, errorMessage } from "../lib/api";
import type { BotCommand } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { AsyncView, Badge, Button, Card, ConfirmModal, EmptyState, Field, Input, Modal, PageHeader, Table, Td, Textarea, Th, Toggle } from "../components/ui";

interface FormState {
  id: number | null;
  command: string;
  description: string;
  response: string;
  isActive: boolean;
}
const EMPTY: FormState = { id: null, command: "", description: "", response: "", isActive: true };

export default function BotCommandsPage() {
  const toast = useToast();
  const list = useAsync(() => api.get<{ items: BotCommand[] }>("/bot/commands").then((r) => r.data.items), []);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<BotCommand | null>(null);
  const [deleting, setDeleting] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    const body = { command: form.command, description: form.description, response: form.response, isActive: form.isActive };
    try {
      if (form.id) await api.put(`/bot/commands/${form.id}`, body);
      else await api.post("/bot/commands", body);
      toast.success("Buyruq saqlandi");
      setForm(null);
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (c: BotCommand) => {
    try {
      await api.put(`/bot/commands/${c.id}`, { isActive: !c.isActive });
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/bot/commands/${toDelete.id}`);
      toast.success(`/${toDelete.command} o'chirildi`);
      setToDelete(null);
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Bot buyruqlari"
        subtitle="Javob matni bazadan olinadi — o'zgartirish botda darhol kuchga kiradi"
        action={
          <Button onClick={() => setForm(EMPTY)}>
            <Plus className="h-4 w-4" /> Yangi buyruq
          </Button>
        }
      />
      <Card>
        <AsyncView state={list}>
          {(items) =>
            items.length === 0 ? (
              <EmptyState title="Buyruqlar yo'q" hint="Masalan /help, /about, /contact" />
            ) : (
              <Table
                head={
                  <tr>
                    <Th>Buyruq</Th>
                    <Th className="hidden md:table-cell">Tavsif</Th>
                    <Th>Javob</Th>
                    <Th>Holat</Th>
                    <Th />
                  </tr>
                }
              >
                {items.map((c) => (
                  <tr key={c.id} className="align-top">
                    <Td className="font-mono font-medium text-gray-900">/{c.command}</Td>
                    <Td className="hidden text-gray-600 md:table-cell">{c.description || "—"}</Td>
                    <Td className="max-w-md">
                      <p className="line-clamp-2 whitespace-pre-wrap text-gray-700">{c.response}</p>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <Toggle checked={c.isActive} onChange={() => void toggle(c)} label="Faol" />
                        <span className="hidden sm:inline">{c.isActive ? <Badge tone="green">Faol</Badge> : <Badge tone="gray">O'chiq</Badge>}</span>
                      </div>
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setForm({ ...c })} aria-label="Tahrirlash">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setToDelete(c)} aria-label="O'chirish">
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </Table>
            )
          }
        </AsyncView>
      </Card>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? "Buyruqni tahrirlash" : "Yangi buyruq"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              Bekor qilish
            </Button>
            <Button type="submit" form="command-form" loading={saving}>
              Saqlash
            </Button>
          </>
        }
      >
        {form && (
          <form id="command-form" onSubmit={save} className="space-y-4">
            <Field label="Buyruq" hint="Kichik lotin harflari, raqamlar va _ — masalan: help">
              <div className="flex">
                <span className="inline-flex items-center rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 px-3 text-sm text-gray-500">/</span>
                <Input className="rounded-l-none" required maxLength={33} value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} />
              </div>
            </Field>
            <Field label="Tavsif">
              <Input maxLength={256} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field label="Javob matni" hint={`${form.response.length} / 4096`}>
              <Textarea rows={6} required maxLength={4096} value={form.response} onChange={(e) => setForm({ ...form, response: e.target.value })} />
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
        title="Buyruqni o'chirish"
        danger
        confirmText="O'chirish"
        loading={deleting}
        onClose={() => setToDelete(null)}
        onConfirm={() => void remove()}
        message={
          <>
            <b>/{toDelete?.command}</b> buyrug'i o'chirilsinmi?
          </>
        }
      />
    </>
  );
}
