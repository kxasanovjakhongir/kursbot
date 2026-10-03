import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Bot, Clock, KeyRound, LifeBuoy, MessageSquareText, ShieldAlert, Type, Wrench, type LucideIcon } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { api, errorMessage } from "../lib/api";
import { normalizeTelegramUsername } from "../lib/format";
import type { BotSettings } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { AsyncView, Badge, Button, Card, CardHeader, ConfirmModal, Field, Input, Modal, PageHeader, Select, Textarea, Toggle } from "../components/ui";

type SectionId = "profile" | "welcome" | "schedule" | "support" | "display";

/** Bitta sozlamalar bo'limi: sarlavha, izoh, maydonlar va o'zining "Saqlash" tugmasi */
function Section({
  icon: Icon,
  title,
  description,
  saving,
  onSubmit,
  footer,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  saving: boolean;
  onSubmit: (e: FormEvent) => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} subtitle={description} action={<Icon className="h-5 w-5 text-gray-400" />} />
      <form onSubmit={onSubmit} className="space-y-4 p-5">
        {children}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="submit" loading={saving}>
            Saqlash
          </Button>
          {footer}
        </div>
      </form>
    </Card>
  );
}

const textsLink = (group: string, label: string) => (
  <Link to={`/bot/texts?group=${group}`} className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800">
    {label} <ArrowRight className="h-4 w-4" />
  </Link>
);

export default function BotSettingsPage() {
  const toast = useToast();
  const state = useAsync(() => api.get<BotSettings>("/bot/settings").then((r) => r.data), []);
  const [form, setForm] = useState<BotSettings | null>(null);
  const [saving, setSaving] = useState<SectionId | null>(null);
  const [maintenanceConfirm, setMaintenanceConfirm] = useState<boolean | null>(null);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [token, setToken] = useState("");
  const [savingToken, setSavingToken] = useState(false);
  const [support, setSupport] = useState("");
  const [supportError, setSupportError] = useState<string | undefined>();
  const [limitError, setLimitError] = useState<string | undefined>();

  useEffect(() => {
    if (state.data) {
      setForm(state.data);
      setSupport(state.data.supportUsername ? `@${state.data.supportUsername}` : "");
    }
  }, [state.data]);

  /** Faqat shu bo'lim maydonlari yuboriladi — boshqa bo'limdagi saqlanmagan o'zgarishlarga tegilmaydi */
  const saveSection = async (id: SectionId, body: Partial<BotSettings>, after?: (body: Partial<BotSettings>) => void) => {
    setSaving(id);
    try {
      await api.put("/bot/settings", body);
      setForm((f) => (f ? { ...f, ...body } : f));
      after?.(body);
      toast.success("Saqlandi");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(null);
    }
  };

  const submit = (id: SectionId, build: () => Partial<BotSettings> | null, after?: (body: Partial<BotSettings>) => void) => (e: FormEvent) => {
    e.preventDefault();
    const body = build();
    if (body) void saveSection(id, body, after);
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
      <PageHeader
        title="Bot sozlamalari"
        subtitle="Har bir bo'lim alohida saqlanadi. Bot xabarlarining matnlari — «Bot matnlari» bo'limida"
        action={
          <Link
            to="/bot/texts"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <MessageSquareText className="h-4 w-4" /> Bot matnlari
          </Link>
        }
      />
      <AsyncView state={state}>
        {() =>
          form && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Section
                icon={Bot}
                title="Bot profili"
                description="Telegram'da ko'rinadigan nom"
                saving={saving === "profile"}
                onSubmit={submit("profile", () => ({ botName: form.botName.trim() }))}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Bot nomi">
                    <Input required maxLength={64} value={form.botName} onChange={(e) => setForm({ ...form, botName: e.target.value })} />
                  </Field>
                  <Field label="Bot username" hint="BotFather orqali o'zgartiriladi">
                    <Input disabled value={`@${form.botUsername}`} />
                  </Field>
                </div>
              </Section>

              <Section
                icon={MessageSquareText}
                title="Salomlashuv"
                description="Havolasiz /start bosilganda yuboriladigan xabar"
                saving={saving === "welcome"}
                onSubmit={submit("welcome", () => ({ welcomeMessage: form.welcomeMessage }))}
                footer={textsLink("start", "Standart salomlashuv matnlari")}
              >
                <Field label="Welcome message" hint="Bo'sh bo'lsa — «Bot matnlari → Boshlash» dagi standart salomlashuv. {ism} — foydalanuvchi ismi">
                  <Textarea rows={4} maxLength={4000} value={form.welcomeMessage} onChange={(e) => setForm({ ...form, welcomeMessage: e.target.value })} />
                </Field>
              </Section>

              <Section
                icon={LifeBuoy}
                title="Telegram yordam"
                description="«💬 Yordam» va «Admin bilan bog'lanish» tugmalari ochadigan profil"
                saving={saving === "support"}
                onSubmit={submit(
                  "support",
                  () => {
                    const value = support.trim();
                    const username = value ? normalizeTelegramUsername(value) : "";
                    if (username === null) {
                      setSupportError("Telegram username noto'g'ri formatda.");
                      return null;
                    }
                    return { supportUsername: username };
                  },
                  (body) => setSupport(body.supportUsername ? `@${body.supportUsername}` : ""),
                )}
                footer={textsLink("help", "Yordam xabarini tahrirlash")}
              >
                <Field label="Yordam Telegram username" error={supportError} hint="«Yordam» tugmasi bosilganda foydalanuvchi ushbu Telegram profiliga yo'naltiriladi.">
                  <Input
                    placeholder="@support_username"
                    maxLength={64}
                    autoComplete="off"
                    value={support}
                    onChange={(e) => {
                      setSupport(e.target.value);
                      setSupportError(undefined);
                    }}
                  />
                </Field>
                {!form.supportUsername && <p className="text-xs text-amber-700">Hozircha sozlanmagan — bot «Yordam xizmati hozircha sozlanmagan» deb javob beradi.</p>}
                <p className="text-xs text-gray-500">O'zgartirilgach yangi xabarlarda darhol, avval yuborilgan xabarlardagi tugmalarda esa bir necha daqiqa ichida yangilanadi.</p>
              </Section>

              <Section
                icon={Clock}
                title="Til va ish vaqti"
                description="Yangi foydalanuvchi tili va cheklar tekshiriladigan vaqt"
                saving={saving === "schedule"}
                onSubmit={submit("schedule", () => ({ defaultLanguage: form.defaultLanguage, workStart: form.workStart, workEnd: form.workEnd }))}
              >
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
                <p className="text-xs text-gray-500">Ish vaqtidan tashqari yuborilgan chekka «ertaga soat … dan keyin tekshiriladi» javobi beriladi.</p>
              </Section>

              <Section
                icon={Type}
                title="Ko'rinish"
                description="Kurs nomlari xabar va tugmalarda qanday ko'rinadi"
                saving={saving === "display"}
                onSubmit={submit("display", () => {
                  const limit = Number(form.courseNameMaxLength);
                  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
                    setLimitError("1 dan 100 gacha butun son kiriting.");
                    return null;
                  }
                  return { courseNameMaxLength: limit };
                })}
              >
                <Field
                  label="Kurs nomi ko'rinish uzunligi"
                  error={limitError}
                  hint="Kurs nomining Telegram'da ko'rsatiladigan maksimal belgilar soni (1–100). Masalan, 7 da «Node js kursi» → «Node js». Bazadagi nom o'zgarmaydi."
                >
                  <Input
                    type="number"
                    required
                    min={1}
                    max={100}
                    step={1}
                    className="sm:w-40"
                    value={Number.isNaN(form.courseNameMaxLength) ? "" : form.courseNameMaxLength}
                    onChange={(e) => {
                      setForm({ ...form, courseNameMaxLength: e.target.valueAsNumber });
                      setLimitError(undefined);
                    }}
                  />
                </Field>
              </Section>

              <Card className={form.maintenanceMode ? "border-amber-300" : ""}>
                <CardHeader title="Maintenance mode" subtitle="Botni vaqtincha to'xtatish" action={<Wrench className="h-5 w-5 text-gray-400" />} />
                <div className="space-y-3 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-gray-900">{form.maintenanceMode ? "Yoqilgan" : "O'chirilgan"}</span>
                    <Toggle checked={form.maintenanceMode} onChange={(v) => setMaintenanceConfirm(v)} label="Maintenance mode" />
                  </div>
                  <p className="text-sm text-gray-500">Yoqilganda foydalanuvchilar texnik xizmat xabarini oladi. Adminlar ishlashda davom etadi.</p>
                  {textsLink("errors", "Texnik xizmat xabarini tahrirlash")}
                </div>
              </Card>

              <Card>
                <CardHeader title="Bot tokeni" subtitle="@BotFather dan olingan token" action={<KeyRound className="h-5 w-5 text-gray-400" />} />
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
