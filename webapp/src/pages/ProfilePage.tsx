import { useState } from "react";
import { Globe, LifeBuoy, MessageSquare, Newspaper, Phone } from "lucide-react";
import { useSession } from "../context/SessionContext";
import { useToast } from "../context/ToastContext";
import { invalidate } from "../hooks/useQuery";
import { errorText, LANG_NAMES, LANGS } from "../i18n";
import { api } from "../lib/api";
import { fmtDate, formatPhone } from "../lib/format";
import { closeApp, openTelegramLink, requestContact, webApp } from "../lib/telegram";
import type { Lang, Me } from "../lib/types";
import { Avatar } from "../components/Avatar";
import { Money } from "../components/Money";
import { PhoneCard } from "../components/PhoneCard";
import { Page, Row, Section, Sheet, Stat, Toggle } from "../components/ui";

/** Profil: ma'lumotlar, statistika, sozlamalar (til, yangiliklar) va yordam */
export default function ProfilePage() {
  const { t, lang, me, setMe, refresh } = useSession();
  const toast = useToast();
  const [langOpen, setLangOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const m = me();
  const u = m.user;

  /** Optimistik: darhol ko'rinadi, xato bo'lsa oldingi holatga qaytadi */
  const save = async (patch: { language?: Lang; newsEnabled?: boolean }) => {
    if (saving) return;
    const prev = m;
    setMe({ ...m, lang: patch.language ?? m.lang, user: { ...u, ...patch } });
    setSaving(true);
    try {
      setMe(await api.patch<Me>("/me/settings", patch));
      if (patch.language) invalidate(""); // matnli ma'lumotlar yangi tilda qayta yuklansin
      toast.success(t("saved"));
    } catch (err) {
      setMe(prev);
      toast.error(errorText(t, err));
    } finally {
      setSaving(false);
    }
  };

  const updatePhone = async () => {
    if (await requestContact()) setTimeout(() => void refresh(), 1500);
  };

  return (
    <Page title={t("profile_title")}>
      <div className="mb-5 flex flex-col items-center text-center">
        <Avatar name={u.firstName} size="lg" />
        <p className="mt-2 text-[20px] font-bold">{[u.firstName, u.lastName].filter(Boolean).join(" ")}</p>
        {u.username && <p className="text-[15px] text-hint">@{u.username}</p>}
      </div>

      <div className="mb-5 grid grid-cols-3 gap-2.5">
        <Stat label={t("stats_books")} value={m.stats.products} tone="accent" />
        <Stat label={t("stats_orders")} value={m.stats.orders} />
        <Stat label={t("stats_paid")} value={<Money amount={m.stats.totalPaid} className="text-[15px]" />} />
      </div>

      {!u.phone && <PhoneCard />}

      <Section>
        <Row title={t("telegram_id")} after={<span className="font-mono">{u.telegramId}</span>} />
        {u.phone && <Row icon={<Phone className="h-5 w-5 text-accent" />} title={t("phone")} after={formatPhone(u.phone)} onClick={webApp() ? () => void updatePhone() : undefined} />}
        <Row title={t("joined_at")} after={fmtDate(u.createdAt, lang)} />
      </Section>

      <Section title={t("settings_title")} footer={t("news_hint")}>
        <Row icon={<Globe className="h-5 w-5 text-accent" />} title={t("language")} after={LANG_NAMES[lang]} onClick={() => setLangOpen(true)} />
        <Row
          icon={<Newspaper className="h-5 w-5 text-accent" />}
          title={t("news")}
          chevron={false}
          after={<Toggle checked={u.newsEnabled} disabled={saving} label={t("news")} onChange={(v) => void save({ newsEnabled: v })} />}
        />
      </Section>

      <Section title={t("help_title")}>
        <ol className="space-y-2 p-4 text-[15px]">
          {(["help_1", "help_2", "help_3", "help_4"] as const).map((k, i) => (
            <li key={k} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-button/12 text-[13px] font-semibold text-accent">{i + 1}</span>
              {t(k)}
            </li>
          ))}
        </ol>
      </Section>

      <Section>
        {m.app.supportUrl && <Row icon={<LifeBuoy className="h-5 w-5 text-accent" />} title={t("contact_admin")} onClick={() => openTelegramLink(m.app.supportUrl!)} />}
        <Row
          icon={<MessageSquare className="h-5 w-5 text-accent" />}
          title={t("open_chat")}
          onClick={() => (webApp() ? closeApp() : m.app.botUrl && openTelegramLink(m.app.botUrl))}
        />
      </Section>

      <Sheet open={langOpen} onClose={() => setLangOpen(false)} title={t("language")}>
        <Section>
          {LANGS.map((l) => (
            <Row
              key={l}
              title={LANG_NAMES[l]}
              chevron={false}
              after={l === lang ? <span className="text-accent">✓</span> : undefined}
              onClick={() => {
                setLangOpen(false);
                if (l !== lang) void save({ language: l });
              }}
            />
          ))}
        </Section>
      </Sheet>
    </Page>
  );
}
