import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { api, errorMessage } from "../lib/api";
import type { BotButtonScreen } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { AsyncView, Badge, Button, Card, CardHeader, ConfirmModal, PageHeader, Toggle } from "../components/ui";

type BotButton = BotButtonScreen["buttons"][number];

export default function BotButtonsPage() {
  const toast = useToast();
  const state = useAsync(() => api.get<{ screens: BotButtonScreen[] }>("/bot/buttons").then((r) => r.data.screens), []);
  const [screens, setScreens] = useState<BotButtonScreen[]>([]);
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  useEffect(() => {
    if (state.data) setScreens(state.data);
  }, [state.data]);

  const toggle = async (id: string, enabled: boolean) => {
    setSaving(true);
    try {
      const r = await api.put<{ screens: BotButtonScreen[] }>("/bot/buttons", { values: { [id]: enabled } });
      setScreens(r.data.screens);
      toast.success(enabled ? "Tugma yoqildi" : "Tugma o'chirildi");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

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
    <li key={b.id} className="flex items-center justify-between gap-4 px-5 py-3">
      <div className="min-w-0">
        <p className={`text-sm font-medium ${b.enabled ? "text-gray-900" : "text-gray-400"}`}>{b.label}</p>
        {b.hint && <p className="text-xs text-gray-500">{b.hint}</p>}
      </div>
      <Toggle checked={b.enabled} disabled={saving} onChange={(v) => void toggle(b.id, v)} label={b.label} />
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
        subtitle="Har bir ekran ostida qaysi tugmalar chiqishini tanlang. O'zgarish yangi xabarlarda darhol ko'rinadi"
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
              const changed = screen.buttons.filter((b) => b.enabled !== b.default).length;
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
        Ro'yxat elementlari (kurslar, darslar, tillar) va sahifalash doim chiqadi. Chat pastidagi doimiy menyu («Darsliklar», «Yordam») va avval yuborilgan xabarlardagi
        tugmalar o'zgarmaydi.
      </p>

      <ConfirmModal
        open={resetOpen}
        title="Standart holatga qaytarilsinmi?"
        confirmText="Qaytarish"
        onClose={() => setResetOpen(false)}
        onConfirm={() => void reset()}
        message="Barcha ekranlardagi tugmalar dastlabki holatiga qaytadi."
      />
    </>
  );
}
