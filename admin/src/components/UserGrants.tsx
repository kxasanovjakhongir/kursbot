import { useState } from "react";
import { CalendarClock, LogOut, RotateCcw } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { fmtDate } from "../lib/format";
import type { AccessGrant, TelegramUserDetail } from "../lib/types";
import { Badge, Button, ConfirmModal, Field, Input, Modal } from "./ui";

const REVOKE_LABEL = { expired: "Muddati tugagan", removed: "Chiqarilgan", banned: "Cheklov sababli" } as const;
const QUICK_DAYS = [30, 90, 180, 365];

function status(g: AccessGrant) {
  if (g.revokedAt) return <Badge tone="gray">{g.revokeReason ? REVOKE_LABEL[g.revokeReason] : "Bekor qilingan"}</Badge>;
  return g.joinedAt ? <Badge tone="green">Kanalda</Badge> : <Badge tone="yellow">Kirmagan</Badge>;
}

/** <input type="date"> uchun: bugundan n kun keyin, YYYY-MM-DD */
const dateInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysFromNow = (n: number) => dateInput(new Date(Date.now() + n * 86400_000));

/**
 * Yopiq kanal kirishlari: muddat belgilash/uzaytirish, muddatsiz qilish, kanaldan chiqarish va tiklash.
 * Muddat tugaganda bot foydalanuvchini kanaldan avtomatik chiqaradi.
 */
export function UserGrants({ user, onChanged }: { user: TelegramUserDetail; onChanged: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState<AccessGrant | null>(null);
  const [date, setDate] = useState("");
  const [unlimited, setUnlimited] = useState(false);
  const [removing, setRemoving] = useState<AccessGrant | null>(null);
  const [busy, setBusy] = useState(false);

  const openEdit = (g: AccessGrant) => {
    const active = !g.revokedAt && g.expiresAt && new Date(g.expiresAt) > new Date();
    setDate(active ? dateInput(new Date(g.expiresAt!)) : daysFromNow(30));
    setUnlimited(!g.revokedAt && !g.expiresAt);
    setEditing(g);
  };

  const saveExpiry = async () => {
    if (!editing) return;
    // Tanlangan kun oxirigacha (mahalliy vaqt bilan) amal qiladi
    const expiresAt = unlimited ? null : new Date(`${date}T23:59:59`).toISOString();
    setBusy(true);
    try {
      await api.put(`/telegram-users/${user.id}/grants/${editing.id}/expiry`, { expiresAt });
      toast.success(editing.revokedAt ? "Kirish tiklandi — foydalanuvchi linkni «Mening xaridlarim» dan oladi" : "Muddat saqlandi");
      setEditing(null);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api.post(`/telegram-users/${user.id}/grants/${removing.id}/revoke`);
      toast.success(`${removing.product.title}: kanaldan chiqarildi`);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  if (user.grants.length === 0) return <p className="text-sm text-gray-500">Xaridlar yo'q</p>;

  return (
    <>
      <ul className="divide-y divide-gray-100">
        {user.grants.map((g) => (
          <li key={g.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between gap-2">
              <span className={`text-sm font-medium ${g.revokedAt ? "text-gray-400" : "text-gray-900"}`}>{g.product.title}</span>
              {status(g)}
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {g.revokedAt
                ? `Bekor qilingan: ${fmtDate(g.revokedAt)}`
                : g.expiresAt
                  ? `Muddat: ${fmtDate(g.expiresAt)} gacha`
                  : "Muddatsiz"}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {g.revokedAt ? (
                <Button variant="secondary" size="sm" onClick={() => openEdit(g)} disabled={user.isBanned} title={user.isBanned ? "Avval cheklovni olib tashlang" : undefined}>
                  <RotateCcw className="h-3.5 w-3.5" /> Tiklash
                </Button>
              ) : (
                <>
                  <Button variant="secondary" size="sm" onClick={() => openEdit(g)}>
                    <CalendarClock className="h-3.5 w-3.5" /> Muddat
                  </Button>
                  {g.product.channelId && (
                    <Button variant="ghost" size="sm" onClick={() => setRemoving(g)}>
                      <LogOut className="h-3.5 w-3.5 text-red-600" /> Chiqarish
                    </Button>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.revokedAt ? "Kirishni tiklash" : "Kanalda qolish muddati"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Bekor qilish
            </Button>
            <Button loading={busy} disabled={!unlimited && !date} onClick={() => void saveExpiry()}>
              {editing?.revokedAt ? "Tiklash" : "Saqlash"}
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              <b>{editing.product.title}</b>. Muddat tugaganda bot foydalanuvchini kanaldan avtomatik chiqaradi. 3 kun oldin eslatma yuboriladi.
            </p>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} />
              Muddatsiz
            </label>
            {!unlimited && (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_DAYS.map((d) => (
                    <Button key={d} variant={date === daysFromNow(d) ? "primary" : "secondary"} size="sm" onClick={() => setDate(daysFromNow(d))}>
                      {d === 365 ? "1 yil" : `${d} kun`}
                    </Button>
                  ))}
                </div>
                <Field label="Qaysi sanagacha" hint="Tanlangan kun oxirigacha amal qiladi">
                  <Input type="date" required min={daysFromNow(0)} value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
              </>
            )}
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={!!removing}
        danger
        loading={busy}
        title="Kanaldan chiqarish"
        confirmText="Chiqarish"
        onClose={() => setRemoving(null)}
        onConfirm={() => void remove()}
        message={`Foydalanuvchi «${removing?.product.title ?? ""}» kanalidan chiqariladi va shaxsiy linki bekor qilinadi. Unga xabar boradi. Keyin «Tiklash» orqali qaytarish mumkin.`}
      />
    </>
  );
}
