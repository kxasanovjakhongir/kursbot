import { useState } from "react";
import { Ban, MessageSquare, ShieldCheck } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { useToast } from "../context/ToastContext";
import type { TelegramUserDetail } from "../lib/types";
import { Button, ConfirmModal, Field, Modal, Textarea } from "./ui";

const MAX_MESSAGE = 3500;

/** Foydalanuvchi sahifasidagi amallar: shaxsiy xabar yuborish, cheklash / cheklovni olib tashlash */
export function UserActions({ user, onChanged }: { user: TelegramUserDetail; onChanged: () => void }) {
  const toast = useToast();
  const [confirmBan, setConfirmBan] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [kick, setKick] = useState(true);
  const activeGrants = user.grants.filter((g) => !g.revokedAt).length;

  const toggleBan = async () => {
    setBusy(true);
    try {
      if (user.isBanned) {
        const r = await api.post<{ restored: number }>(`/telegram-users/${user.id}/unban`);
        toast.success(r.data.restored ? `Cheklov olib tashlandi, ${r.data.restored} ta kanal kirishi tiklandi` : "Cheklov olib tashlandi");
      } else {
        const r = await api.post<{ channels: { removed: number; failed: string[] } }>(`/telegram-users/${user.id}/ban`, { removeFromChannels: kick });
        const { removed, failed } = r.data.channels;
        toast.success(removed ? `Foydalanuvchi cheklandi va ${removed} ta kanaldan chiqarildi` : "Foydalanuvchi cheklandi");
        if (failed.length) toast.error(`Chiqarib bo'lmadi (bot kanalda admin emas yoki huquqi yo'q): ${failed.join(", ")}`);
      }
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setConfirmBan(false);
    }
  };

  const sendMessage = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ delivered: boolean }>(`/telegram-users/${user.id}/message`, { text });
      if (r.data.delivered) toast.success("Xabar yuborildi");
      else toast.error("Yetkazilmadi: foydalanuvchi botni bloklagan");
      setText("");
      setMessageOpen(false);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" onClick={() => setMessageOpen(true)}>
        <MessageSquare className="h-4 w-4" /> Xabar yuborish
      </Button>
      <Button variant={user.isBanned ? "secondary" : "danger"} size="sm" onClick={() => setConfirmBan(true)}>
        {user.isBanned ? <ShieldCheck className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
        {user.isBanned ? "Cheklovni olib tashlash" : "Cheklash"}
      </Button>

      <ConfirmModal
        open={confirmBan}
        danger={!user.isBanned}
        loading={busy}
        title={user.isBanned ? "Cheklovni olib tashlash" : "Foydalanuvchini cheklash"}
        confirmText={user.isBanned ? "Ha, tiklash" : "Ha, cheklash"}
        onClose={() => setConfirmBan(false)}
        onConfirm={() => void toggleBan()}
        message={
          user.isBanned ? (
            "Foydalanuvchi botdan yana to'liq foydalana oladi. Cheklov sababli yopilgan kanal kirishlari tiklanadi (muddati o'tmagan bo'lsa)."
          ) : (
            <>
              Bot bu foydalanuvchiga javob bermaydi va unga ommaviy xabarlar yuborilmaydi. Keyin istalgan vaqtda tiklash mumkin.
              {activeGrants > 0 && (
                <label className="mt-3 flex items-center gap-2 font-medium text-gray-800">
                  <input type="checkbox" checked={kick} onChange={(e) => setKick(e.target.checked)} />
                  Yopiq kanallardan ham chiqarish ({activeGrants} ta)
                </label>
              )}
            </>
          )
        }
      />

      <Modal
        open={messageOpen}
        onClose={() => setMessageOpen(false)}
        title="Shaxsiy xabar"
        footer={
          <>
            <Button variant="secondary" onClick={() => setMessageOpen(false)}>
              Bekor qilish
            </Button>
            <Button loading={busy} disabled={!text.trim() || text.length > MAX_MESSAGE} onClick={() => void sendMessage()}>
              Yuborish
            </Button>
          </>
        }
      >
        <Field label="Xabar matni" hint={`${text.length} / ${MAX_MESSAGE} · "💬 Admin xabari" sarlavhasi bilan boradi`}>
          <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </Field>
      </Modal>
    </div>
  );
}
