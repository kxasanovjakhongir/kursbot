import { useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { api, errorMessage } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import type { PanelUser, Role } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { AsyncView, Badge, Button, Card, ConfirmModal, Field, Input, Modal, PageHeader, Select, Table, Td, Th, Toggle } from "../components/ui";

interface FormState {
  id: number | null;
  email: string;
  name: string;
  password: string;
  role: Role;
  isActive: boolean;
}

export default function AdminsPage() {
  const { user: me } = useAuth();
  const toast = useToast();
  const list = useAsync(() => api.get<{ items: PanelUser[] }>("/admins").then((r) => r.data.items), []);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<PanelUser | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      if (form.id) {
        await api.put(`/admins/${form.id}`, { name: form.name, role: form.role, isActive: form.isActive, ...(form.password ? { password: form.password } : {}) });
      } else {
        await api.post("/admins", { email: form.email, name: form.name, password: form.password, role: form.role });
      }
      toast.success("Saqlandi");
      setForm(null);
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    try {
      await api.delete(`/admins/${toDelete.id}`);
      toast.success("Admin o'chirildi");
      setToDelete(null);
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader
        title="Adminlar"
        subtitle="Admin panelga kirish huquqi bor xodimlar"
        action={
          <Button onClick={() => setForm({ id: null, email: "", name: "", password: "", role: "admin", isActive: true })}>
            <Plus className="h-4 w-4" /> Admin qo'shish
          </Button>
        }
      />
      <Card>
        <AsyncView state={list}>
          {(items) => (
            <Table
              head={
                <tr>
                  <Th>Ism</Th>
                  <Th>Email</Th>
                  <Th>Rol</Th>
                  <Th>Holat</Th>
                  <Th className="hidden md:table-cell">Oxirgi kirish</Th>
                  <Th />
                </tr>
              }
            >
              {items.map((a) => (
                <tr key={a.id}>
                  <Td className="font-medium text-gray-900">
                    {a.name} {a.id === me?.id && <span className="text-xs text-gray-400">(siz)</span>}
                  </Td>
                  <Td className="text-gray-600">{a.email}</Td>
                  <Td>{a.role === "superadmin" ? <Badge tone="blue">Super Admin</Badge> : <Badge tone="gray">Admin</Badge>}</Td>
                  <Td>{a.isActive ? <Badge tone="green">Faol</Badge> : <Badge tone="red">Bloklangan</Badge>}</Td>
                  <Td className="hidden whitespace-nowrap text-gray-500 md:table-cell">{fmtDateTime(a.lastLoginAt)}</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setForm({ id: a.id, email: a.email, name: a.name, password: "", role: a.role, isActive: a.isActive })} aria-label="Tahrirlash">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {a.id !== me?.id && (
                        <Button variant="ghost" size="sm" onClick={() => setToDelete(a)} aria-label="O'chirish">
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </AsyncView>
      </Card>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? "Adminni tahrirlash" : "Yangi admin"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              Bekor qilish
            </Button>
            <Button type="submit" form="admin-form" loading={saving}>
              Saqlash
            </Button>
          </>
        }
      >
        {form && (
          <form id="admin-form" onSubmit={save} className="space-y-4">
            <Field label="Email">
              <Input type="email" required disabled={!!form.id} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Ism">
              <Input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label={form.id ? "Yangi parol (ixtiyoriy)" : "Parol"} hint="Kamida 8 belgi">
              <Input type="password" autoComplete="new-password" minLength={8} required={!form.id} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            <Field label="Rol" hint="Admin: foydalanuvchilar, xabarlar, broadcast, buyruqlar. Super Admin: hammasi + adminlar, loglar, sozlamalar">
              <Select value={form.role} disabled={form.id === me?.id} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                <option value="admin">Admin</option>
                <option value="superadmin">Super Admin</option>
              </Select>
            </Field>
            {form.id && form.id !== me?.id && (
              <div className="flex items-center gap-3">
                <Toggle checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label="Faol" />
                <span className="text-sm text-gray-700">Faol (o'chirilsa panelga kira olmaydi)</span>
              </div>
            )}
          </form>
        )}
      </Modal>

      <ConfirmModal
        open={!!toDelete}
        title="Adminni o'chirish"
        danger
        confirmText="O'chirish"
        onClose={() => setToDelete(null)}
        onConfirm={() => void remove()}
        message={
          <>
            <b>{toDelete?.email}</b> o'chirilsinmi? Bu amalni qaytarib bo'lmaydi.
          </>
        }
      />
    </>
  );
}
