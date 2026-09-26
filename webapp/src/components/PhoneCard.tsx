import { useState } from "react";
import { Smartphone } from "lucide-react";
import { useSession } from "../context/SessionContext";
import { useToast } from "../context/ToastContext";
import { useAction } from "../hooks/useAction";
import { openTelegramLink, requestContact } from "../lib/telegram";
import { Button } from "./ui";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Telefon ulashish (TZ 5.2 — faqat o'z raqami). Telegram kontaktni bot chatiga yuboradi,
 * bot uni saqlaydi; biz esa /me orqali saqlanganini kutamiz — frontend raqamni o'zi yubormaydi.
 */
export function PhoneCard({ onSaved }: { onSaved?: () => void }) {
  const { t, refresh, me } = useSession();
  const toast = useToast();
  const [unsupported, setUnsupported] = useState(false);

  const [share, busy] = useAction(async () => {
    const shared = await requestContact();
    if (!shared) {
      setUnsupported(true);
      return;
    }
    for (let i = 0; i < 10; i++) {
      await sleep(800);
      const fresh = await refresh();
      if (fresh?.user.phone) {
        toast.success(t("phone_saved"));
        onSaved?.();
        return;
      }
    }
    toast.error(t("error_generic"));
  });

  return (
    <div className="mb-5 rounded-2xl bg-section p-4">
      <div className="flex gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-button/12 text-accent">
          <Smartphone className="h-5 w-5" />
        </span>
        <div>
          <p className="font-semibold">{t("phone_title")}</p>
          <p className="mt-0.5 text-[14px] text-hint">{unsupported ? t("phone_unsupported") : t("phone_text")}</p>
        </div>
      </div>
      {unsupported && me().app.botUrl ? (
        <Button variant="secondary" block className="mt-3" onClick={() => openTelegramLink(me().app.botUrl!)}>
          {t("open_chat")}
        </Button>
      ) : (
        <Button block className="mt-3" loading={busy} onClick={share}>
          {busy ? t("phone_waiting") : t("phone_button")}
        </Button>
      )}
    </div>
  );
}
