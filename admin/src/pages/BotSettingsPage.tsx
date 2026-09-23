import { useEffect, useState, type FormEvent } from "react";
import { KeyRound, ShieldAlert, Wrench } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { api, errorMessage } from "../lib/api";
import type { BotSettings } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { AsyncView, Badge, Button, Card, CardHeader, ConfirmModal, Field, Input, Modal, PageHeader, Select, Textarea, Toggle } from "../components/ui";

export default function BotSettingsPage() {
  const toast = useToast();
  const state = useAsync(() => api.get<BotSettings>("/bot/settings").then((r) => r.data), []);
  const [form, setForm] = useState<BotSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [maintenanceConfirm, setMaintenanceConfirm] = useState<boolean | null>(null);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [token, setToken] = useState("");
  const [savingToken, setSavingToken] = useState(false);

  useEffect(() => {
    if (state.data) setForm(state.data);
  }, [state.data]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      await api.put("/bot/settings", {
        botName: form.botName,
        welcomeMessage: form.welcomeMessage,
        defaultLanguage: form.defaultLanguage,
        workStart: form.workStart,
        workEnd: form.workEnd,
      });
      toast.success("Sozlamalar saqlandi");
      state.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const setMaintenance = async (enabled: boolean) => {
    try {
      await api.put("/bot/maintenance", { enabled });
      setForm((f) => (f ? { ...f, maintenanceMode: enabled } : f));
      toast.success(`Maintenance mode ${enabled ? "yoqildi" : "o'chirildi"}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setMaintenanceConfirm(null);
    }
  };

  const saveToken = async (e: FormEvent) => {
    e.preventDefault();
    setSavingToken(true);
    try {
      const r = await api.put<{ username: string }>("/bot/token", { token });
      toast.success(`Token saqlandi (@${r.data.username}). Kuchga kirishi uchun serverni qayta ishga tushiring.`);
      setToken("");
      setTokenOpen(false);
      state.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSavingToken(false);
    }
  };

  return (
    <>
      <PageHeader title="Bot sozlamalari" subtitle="Faqat Super Admin uchun" />
      <AsyncView state={state}>
        {() =>
          form && (
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader title="Asosiy" />
                <form onSubmit={save} className="space-y-4 p-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Bot nomi" hint="Telegram'da ko'rinadigan nom">
                      <Input required maxLength={64} value={form.botName} onChange={(e) => setForm({ ...form, botName: e.target.value })} />
                    </Field>
                    <Field label="Bot username" hint="BotFather orqali o'zgartiriladi">
                      <Input disabled value={`@${form.botUsername}`} />
                    </Field>
                  </div>
                  <Field label="Welcome message" hint="Havolasiz /start bosilganda yuboriladi. Bo'sh bo'lsa — standart salomlashuv">
                    <Textarea rows={4} maxLength={4000} value={form.welcomeMessage} onChange={(e) => setForm({ ...form, welcomeMessage: e.target.value })} />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Standart til">
                      <Select value={form.defaultLanguage} onChange={(e) => setForm({ ...form, defaultLanguage: e.target.value as BotSettings["defaultLanguage"] })}>
                        <option value="uz">O'zbek</option>
                        <option value="ru">Русский</option>
                        <option value="en">English</option>
                      </Select>
                    </Field>
                    <Field label="Ish vaqti boshi">
                      <Input type="time" required value={form.workStart} onChange={(e) => setForm({ ...form, workStart: e.target.value })} />
                    </Field>
                    <Field label="Ish vaqti oxiri">
                      <Input type="time" required value={form.workEnd} onChange={(e) => setForm({ ...form, workEnd: e.target.value })} />
                    </Field>
                  </div>
                  <Button type="submit" loading={saving}>
                    Saqlash
                  </Button>
                </form>
              </Card>

              <div className="space-y-6">
                <Card className={form.maintenanceMode ? "border-amber-300" : ""}>
                  <CardHeader title="Maintenance mode" action={<Wrench className="h-5 w-5 text-gray-400" />} />
                  <div className="space-y-3 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-gray-900">{form.maintenanceMode ? "Yoqilgan" : "O'chirilgan"}</span>
                      <Toggle checked={form.maintenanceMode} onChange={(v) => setMaintenanceConfirm(v)} label="Maintenance mode" />
                    </div>
                    <p className="text-sm text-gray-500">
                      Yoqilganda foydalanuvchilar «Tizim vaqtincha texnik xizmatda…» xabarini oladi. Adminlar ishlashda davom etadi.
                    </p>
                  </div>
                </Card>

                <Card>
                  <CardHeader title="Bot tokeni" action={<KeyRound className="h-5 w-5 text-gray-400" />} />
                  <div className="space-y-3 p-5">
                    <Input disabled value={form.botToken} className="font-mono tracking-widest" />
                    <p className="flex items-center gap-2 text-xs text-gray-500">
                      Manba: <Badge tone="gray">{form.tokenSource === "database" ? "baza (shifrlangan)" : ".env"}</Badge>
                    </p>
                    <Button variant="secondary" onClick={() => setTokenOpen(true)}>
                      Tokenni yangilash
                    </Button>
                  </div>
                </Card>
              </div>
            </div>
          )
        }
      </AsyncView>

      <ConfirmModal
        open={maintenanceConfirm !== null}
        title={maintenanceConfirm ? "Maintenance mode yoqilsinmi?" : "Maintenance mode o'chirilsinmi?"}
        danger={maintenanceConfirm === true}
        confirmText={maintenanceConfirm ? "Yoqish" : "O'chirish"}
        onClose={() => setMaintenanceConfirm(null)}
        onConfirm={() => maintenanceConfirm !== null && void setMaintenance(maintenanceConfirm)}
        message={maintenanceConfirm ? "Bot barcha mijozlarga javob berishni to'xtatadi — sotuv ham to'xtaydi." : "Bot yana odatdagidek ishlaydi."}
      />

      <Modal
        open={tokenOpen}
        onClose={() => setTokenOpen(false)}
        title="Bot tokenini yangilash"
        footer={
          <>
            <Button variant="secondary" onClick={() => setTokenOpen(false)}>
              Bekor qilish
            </Button>
            <Button type="submit" form="token-form" loading={savingToken}>
              Saqlash
            </Button>
          </>
        }
      >
        <form id="token-form" onSubmit={saveToken} className="space-y-4">
          <div className="flex gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            <ShieldAlert className="h-5 w-5 shrink-0" />
            Token Telegram orqali tekshiriladi va bazada shifrlangan holda saqlanadi. Yangi token server qayta ishga tushgandan keyin ishlaydi.
          </div>
          <Field label="Yangi token" hint="@BotFather dan olingan: 123456789:AA...">
            <Input type="password" autoComplete="off" required value={token} onChange={(e) => setToken(e.target.value)} className="font-mono" />
          </Field>
        </form>
      </Modal>
    </>
  );
}
