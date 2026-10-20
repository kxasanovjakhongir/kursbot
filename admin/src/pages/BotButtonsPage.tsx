import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { api, errorMessage } from "../lib/api";
import type { BotButtonColor, BotButtonScreen } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { AsyncView, Badge, Button, Card, CardHeader, ConfirmModal, PageHeader, Toggle } from "../components/ui";

type BotButton = BotButtonScreen["buttons"][number];

/** Telegram tugma ranglari (taxminiy ko'rinishi; aniq tus foydalanuvchi mavzusiga bog'liq) */
const COLORS: { value: BotButtonColor; name: string; swatch: string }[] = [
  { value: null, name: "Rangsiz", swatch: "bg-white ring-1 ring-inset ring-gray-300" },
  { value: "primary", name: "Ko'k", swatch: "bg-[#3390ec]" },
  { value: "success", name: "Yashil", swatch: "bg-[#31b545]" },
  { value: "danger", name: "Qizil", swatch: "bg-[#e53935]" },
];
const colorName = (c: BotButtonColor) => COLORS.find((x) => x.value === c)?.name ?? "Rangsiz";

const isChanged = (b: BotButton) => b.enabled !== b.default || (b.colorable && b.color !== b.defaultColor);

export default function BotButtonsPage() {
  const toast = useToast();
  const state = useAsync(() => api.get<{ screens: BotButtonScreen[] }>("/bot/buttons").then((r) => r.data.screens), []);
  const [screens, setScreens] = useState<BotButtonScreen[]>([]);
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  useEffect(() => {
    if (state.data) setScreens(state.data);
  }, [state.data]);

  const save = async (body: { values?: Record<string, boolean>; colors?: Record<string, BotButtonColor> }, done: string) => {
    setSaving(true);
    try {
      const r = await api.put<{ screens: BotButtonScreen[] }>("/bot/buttons", body);
      setScreens(r.data.screens);
      toast.success(done);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const toggle = (id: string, enabled: boolean) => save({ values: { [id]: enabled } }, enabled ? "Tugma yoqildi" : "Tugma o'chirildi");
  const setColor = (id: string, color: BotButtonColor) => save({ colors: { [id]: color } }, `Rang: ${colorName(color).toLowerCase()}`);

  const reset = async () => {
    setSaving(true);
    try {
      const r = await api.post<{ screens: BotButtonScreen[] }>("/bot/buttons/reset");
      setScreens(r.data.screens);
      toast.success("Barcha tugmalar standart holatga qaytarildi");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
      setResetOpen(false);
    }
  };

  const row = (b: BotButton) => (
    <li key={b.id} className="px-5 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className={`text-sm font-medium ${b.enabled ? "text-gray-900" : "text-gray-400"}`}>{b.label}</p>
          {b.hint && <p className="text-xs text-gray-500">{b.hint}</p>}
        </div>
        <Toggle checked={b.enabled} disabled={saving} onChange={(v) => void toggle(b.id, v)} label={b.label} />
      </div>
      {b.colorable && (
        <div className="mt-2 flex flex-wrap items-center gap-2" role="radiogroup" aria-label={`${b.label} — rang`}>
          <span className="text-xs text-gray-500">Rang:</span>
          {COLORS.map((c) => {
            const active = b.color === c.value;
            return (
              <button
                key={c.name}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={saving || active}
                onClick={() => void setColor(b.id, c.value)}
                title={c.value === b.defaultColor ? `${c.name} (standart)` : c.name}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:cursor-default ${
                  active ? "border-blue-500 bg-blue-50 font-medium text-blue-700" : "border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                } ${saving && !active ? "opacity-50" : ""}`}
              >
                <span className={`h-3 w-3 rounded-full ${c.swatch}`} />
                {c.name}
              </button>
            );
          })}
        </div>
      )}
    </li>
  );

  const group = (title: string, buttons: BotButton[]) =>
    buttons.length > 0 && (
      <>
        <p className="border-t border-gray-100 bg-gray-50 px-5 py-2 text-xs font-medium uppercase tracking-wide text-gray-500">{title}</p>
        <ul className="divide-y divide-gray-100">{buttons.map(row)}</ul>
      </>
    );

  return (
    <>
      <PageHeader
        title="Bot tugmalari"
        subtitle="Har bir ekran ostida qaysi tugmalar chiqishini va asosiy tugmalarning rangini tanlang. O'zgarish yangi xabarlarda darhol ko'rinadi"
        action={
          <Button variant="secondary" onClick={() => setResetOpen(true)} disabled={saving}>
            <RotateCcw className="h-4 w-4" /> Standartga qaytarish
          </Button>
        }
      />
      <AsyncView state={state}>
        {() => (
          <div className="grid gap-6 lg:grid-cols-2">
            {screens.map((screen) => {
              const changed = screen.buttons.filter(isChanged).length;
              return (
                <Card key={screen.id}>
                  <CardHeader title={screen.title} action={changed > 0 ? <Badge tone="yellow">{changed} ta o'zgartirilgan</Badge> : undefined} />
                  {group(
                    "Ekran tugmalari",
                    screen.buttons.filter((b) => !b.common),
                  )}
                  {group(
                    "Umumiy tugmalar",
                    screen.buttons.filter((b) => b.common),
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </AsyncView>
      <p className="mt-6 text-xs text-gray-500">
        Rang Telegram'ning tugma uslubi: ko'k, yashil yoki qizil — aniq tus foydalanuvchining Telegram mavzusiga bog'liq; Telegram'ning eski
        versiyalarida tugma rangsiz ko'rinadi. Ro'yxat elementlari (kurslar, darslar, tillar) va sahifalash doim chiqadi. Chat pastidagi doimiy menyu («Darsliklar», «Yordam») va avval yuborilgan xabarlardagi
        tugmalar o'zgarmaydi.
      </p>

      <ConfirmModal
        open={resetOpen}
        title="Standart holatga qaytarilsinmi?"
        confirmText="Qaytarish"
        onClose={() => setResetOpen(false)}
        onConfirm={() => void reset()}
        message="Barcha ekranlardagi tugmalar (yoqilganligi va rangi) dastlabki holatiga qaytadi."
      />
    </>
  );
}
