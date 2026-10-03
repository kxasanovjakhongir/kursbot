import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Bold, ChevronDown, ChevronRight, Code, Eye, Italic, RotateCcw, Search, Underline } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { useAsync } from "../hooks/useAsync";
import { api, errorMessage } from "../lib/api";
import { botTextError, missingRecommendedVars, previewHtml } from "../lib/botText";
import type { BotTextItem, BotTexts } from "../lib/types";
import { AsyncView, Badge, Button, Card, EmptyState, Input, PageHeader, Select, Textarea, Toggle } from "../components/ui";

const FORMAT_BADGE: Record<BotTextItem["format"], { label: string; tone: "gray" | "blue" } | null> = {
  html: null,
  part: { label: "Xabar qismi", tone: "gray" },
  popup: { label: "Qisqa oyna · formatlashsiz", tone: "blue" },
};

/** Bot bu matnni yubormaydi: paneldan o'chirilgan yoki bo'sh saqlangan */
const isOff = (item: BotTextItem) => item.disabled || !item.value.trim();

/** Yopiq qatorda ko'rinadigan qisqa matn: teglarsiz, bir qatorda */
const summary = (text: string) => text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

/** Bitta matn: tahrirlash, o'zgaruvchi qo'shish, formatlash, ko'rinish, saqlash va standartga qaytarish */
function TextEditor({
  item,
  value,
  saving,
  toggling,
  onChange,
  onSave,
  onToggle,
}: {
  item: BotTextItem;
  value: string;
  saving: boolean;
  toggling: boolean;
  onChange: (v: string) => void;
  onSave: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const dirty = value !== item.value;
  // Saqlanmagan o'zgarishi bor matn yopilmaydi — ko'zdan qochmasin
  const open = expanded || dirty;
  const error = dirty ? botTextError(item, value) : null;
  const badge = FORMAT_BADGE[item.format];
  // Yuborilmaydi: paneldan o'chirilgan yoki bo'sh saqlangan
  const off = isOff(item);
  const recommended = missingRecommendedVars(item, value);

  /** Kursor joyiga qo'shish yoki belgilangan matnni teg bilan o'rash */
  const insert = (before: string, after = "") => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + before + value.slice(start, end) + after + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + before.length, end + before.length);
    });
  };

  return (
    <Card className={dirty ? "border-blue-300 ring-1 ring-blue-100" : ""}>
      {/* Yopiq holatda — bitta qator: nom, matnning boshi va yoqish/o'chirish; bosilsa tahrirlash ochiladi */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={() => setExpanded(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />}
          <span className={`min-w-0 ${off ? "opacity-60" : ""}`}>
            <span className="block truncate text-sm font-medium text-gray-900">{item.title}</span>
            {!open && <span className="block truncate text-xs text-gray-500">{summary(item.value) || "Bo'sh — yuborilmaydi"}</span>}
          </span>
        </button>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {badge && open && <Badge tone={badge.tone}>{badge.label}</Badge>}
          {item.overridden && <Badge tone="yellow">O'zgartirilgan</Badge>}
          {dirty && <Badge tone="blue">Saqlanmagan</Badge>}
          {off && <Badge tone="red">O'chirilgan</Badge>}
          <Toggle checked={!off} disabled={toggling} onChange={onToggle} label={`${item.title}: yoqish yoki o'chirish`} />
        </div>
      </div>

      {open && (
      <div className="space-y-3 border-t border-gray-100 p-4">
        {item.hint && <p className="text-sm text-gray-500">{item.hint}</p>}

        <Textarea
          ref={ref}
          rows={Math.min(12, Math.max(item.format === "popup" ? 2 : 3, value.split("\n").length + 1))}
          maxLength={item.max}
          value={value}
          placeholder="Bo'sh — bu matn yuborilmaydi"
          onChange={(e) => onChange(e.target.value)}
          className={error ? "border-red-400 focus:border-red-500 focus:ring-red-500" : ""}
        />

        <div className="flex flex-wrap items-center gap-1.5">
          {item.format !== "popup" && (
            <>
              <Button type="button" variant="ghost" size="sm" title="Qalin" onClick={() => insert("<b>", "</b>")}>
                <Bold className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="sm" title="Kursiv" onClick={() => insert("<i>", "</i>")}>
                <Italic className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="sm" title="Tagiga chizilgan" onClick={() => insert("<u>", "</u>")}>
                <Underline className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="sm" title="Kod (nusxalanadigan)" onClick={() => insert("<code>", "</code>")}>
                <Code className="h-3.5 w-3.5" />
              </Button>
              <span className="mx-1 h-4 w-px bg-gray-200" />
            </>
          )}
          {item.vars.map((v) => (
            <button
              key={v}
              type="button"
              title="Kursor joyiga qo'shish"
              onClick={() => insert(`{${v}}`)}
              className={`rounded-md border px-1.5 py-0.5 font-mono text-xs ${
                item.required.includes(v) ? "border-blue-300 bg-blue-50 text-blue-700" : "border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100"
              }`}
            >
              {`{${v}}`}
              {item.required.includes(v) && " *"}
            </button>
          ))}
          <span className={`ml-auto text-xs ${value.length > item.max * 0.9 ? "text-amber-600" : "text-gray-400"}`}>
            {value.length} / {item.max}
          </span>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
        {!error && dirty && !value.trim() && <p className="text-xs text-amber-700">Bo'sh saqlansa, bu matn o'chiriladi — bot uni yubormaydi.</p>}
        {!error && recommended.length > 0 && (
          <p className="text-xs text-amber-700">
            Matnda {recommended.map((v) => `{${v}}`).join(", ")} yo'q — haqiqiy qiymat ko'rsatilmaydi. Majburiy emas.
          </p>
        )}
        {off && !dirty && (
          <p className="text-xs text-gray-500">
            {item.disabled ? "O'chirilgan: matn saqlanib turadi, lekin bot uni hech bir tilda yubormaydi." : "Bo'sh: bot bu matnni shu tilda yubormaydi."}
            {item.format === "html" && " Tugmali ekranda matn o'rniga 👇 chiqadi (Telegram bo'sh xabarni qabul qilmaydi)."}
          </p>
        )}

        {preview && (
          <div className="rounded-xl bg-[#8fb6d6] p-3">
            <div
              className="max-w-[360px] whitespace-pre-wrap break-words rounded-2xl rounded-bl-md bg-white px-3 py-2 text-[15px] leading-snug text-gray-900 shadow"
              // previewHtml hamma narsani escape qiladi va faqat ruxsat etilgan teglarni o'zinikiga almashtiradi
              dangerouslySetInnerHTML={{ __html: previewHtml(value) }}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
          <Button type="button" size="sm" disabled={!dirty || !!error} loading={saving} onClick={onSave}>
            Saqlash
          </Button>
          {dirty && (
            <Button type="button" size="sm" variant="secondary" onClick={() => onChange(item.value)}>
              Bekor qilish
            </Button>
          )}
          {value !== item.default && (
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange(item.default)}>
              <RotateCcw className="h-3.5 w-3.5" /> Standart matn
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={() => setPreview((p) => !p)}>
            <Eye className="h-3.5 w-3.5" /> {preview ? "Ko'rinishni yopish" : "Ko'rinish"}
          </Button>
          <code className="text-[11px] text-gray-400">{item.key}</code>
        </div>
      </div>
      )}
    </Card>
  );
}

/** Bot matnlari: botdagi barcha tayyor xabar shablonlari, bo'limlar va tillar bo'yicha */
export default function BotTextsPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [lang, setLang] = useState<BotTexts["lang"]>("uz");
  const state = useAsync(() => api.get<BotTexts>("/bot/texts", { params: { lang } }).then((r) => r.data), [lang]);
  const [data, setData] = useState<BotTexts | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const group = params.get("group") ?? "all";

  useEffect(() => {
    if (state.data) {
      setData(state.data);
      setDrafts({});
    }
  }, [state.data]);

  const dirtyKeys = useMemo(() => (data ? data.items.filter((i) => drafts[i.key] !== undefined && drafts[i.key] !== i.value).map((i) => i.key) : []), [data, drafts]);

  // Saqlanmagan o'zgarish bilan sahifani yopishdan oldin ogohlantirish
  useEffect(() => {
    if (!dirtyKeys.length) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirtyKeys.length]);

  const save = async (keys: string[]) => {
    if (!data || !keys.length) return;
    const invalid = keys.map((k) => data.items.find((i) => i.key === k)!).find((i) => botTextError(i, drafts[i.key]));
    if (invalid) {
      toast.error(`«${invalid.title}»: ${botTextError(invalid, drafts[invalid.key])}`);
      return;
    }
    setSaving(keys.length === 1 ? keys[0] : "all");
    try {
      const values = Object.fromEntries(keys.map((k) => [k, drafts[k]]));
      const r = await api.put<BotTexts>("/bot/texts", { lang, values });
      setData(r.data);
      setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !keys.includes(k))));
      toast.success(keys.length === 1 ? "Saqlandi — bot keyingi xabarda yangi matnni ishlatadi" : `${keys.length} ta matn saqlandi`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(null);
    }
  };

  /** Yoqish/o'chirish darhol saqlanadi (barcha tillar uchun); saqlanmagan qoralamalarga tegilmaydi */
  const toggle = async (key: string, enabled: boolean) => {
    setToggling(key);
    try {
      const r = await api.put<BotTexts>("/bot/texts", { lang, enabled: { [key]: enabled } });
      setData(r.data);
      // Bo'sh qoralama yoqilgan matnni yana o'chirib qo'ymasligi uchun olib tashlanadi
      if (enabled) setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k, v]) => k !== key || v.trim())));
      toast.success(enabled ? "Matn yoqildi" : "Matn o'chirildi — bot uni yubormaydi");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setToggling(null);
    }
  };

  /** Bo'limdagi barcha matnlarni birdan yoqish yoki o'chirish */
  const toggleGroup = async (id: string, enabled: boolean) => {
    if (!data) return;
    const keys = data.items.filter((i) => i.group === id && isOff(i) === enabled).map((i) => i.key);
    if (!keys.length) return;
    if (!enabled && !window.confirm(`Bo'limdagi ${keys.length} ta matn o'chiriladi — bot ularni yubormaydi. Davom etilsinmi?`)) return;
    setToggling(id);
    try {
      const r = await api.put<BotTexts>("/bot/texts", { lang, enabled: Object.fromEntries(keys.map((k) => [k, enabled])) });
      setData(r.data);
      toast.success(`${keys.length} ta matn ${enabled ? "yoqildi" : "o'chirildi"}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setToggling(null);
    }
  };

  /** Bo'lim sarlavhasi yonidagi "hammasini yoqish/o'chirish" */
  const groupSwitch = (id: string) => {
    const items = data?.items.filter((i) => i.group === id) ?? [];
    const offCount = items.filter(isOff).length;
    const allOff = offCount === items.length;
    return (
      <span className="flex items-center gap-2 text-xs font-normal normal-case tracking-normal text-gray-500">
        {offCount > 0 && `${offCount} / ${items.length} o'chirilgan`}
        <Button type="button" size="sm" variant="ghost" disabled={toggling !== null} onClick={() => void toggleGroup(id, allOff)}>
          {allOff ? "Hammasini yoqish" : "Hammasini o'chirish"}
        </Button>
      </span>
    );
  };

  const changeLang = (next: BotTexts["lang"]) => {
    if (dirtyKeys.length && !window.confirm("Saqlanmagan o'zgarishlar yo'qoladi. Davom etilsinmi?")) return;
    setLang(next);
  };

  const q = query.trim().toLowerCase();
  const visible = (data?.items ?? []).filter(
    (i) =>
      (group === "all" || i.group === group) &&
      (!onlyChanged || i.overridden || i.disabled || dirtyKeys.includes(i.key)) &&
      (!q || i.title.toLowerCase().includes(q) || i.key.includes(q) || (drafts[i.key] ?? i.value).toLowerCase().includes(q)),
  );
  const groupOf = (id: string) => data?.groups.find((g) => g.id === id);

  return (
    <>
      <PageHeader
        title="Bot matnlari"
        subtitle="Keraksiz xabarni o'ngdagi tugma bilan o'chiring; matnni o'zgartirish uchun qatorni bosing"
        action={
          <div className="flex items-center gap-2">
            <Link to="/bot/settings" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
              <ArrowLeft className="h-4 w-4" /> Bot sozlamalari
            </Link>
            <Select value={lang} onChange={(e) => changeLang(e.target.value as BotTexts["lang"])} className="w-36" aria-label="Til">
              <option value="uz">O'zbek</option>
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </Select>
          </div>
        }
      />
      <AsyncView state={state}>
        {() =>
          data && (
            <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
              <nav className="space-y-1 lg:sticky lg:top-4 lg:self-start">
                {[{ id: "all", title: "Barcha matnlar", description: "" }, ...data.groups].map((g) => {
                  const items = data.items.filter((i) => g.id === "all" || i.group === g.id);
                  const changed = items.filter((i) => i.overridden || i.disabled).length;
                  const unsaved = items.filter((i) => dirtyKeys.includes(i.key)).length;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setParams(g.id === "all" ? {} : { group: g.id })}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                        group === g.id ? "bg-blue-50 font-medium text-blue-700" : "text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      <span>{g.title}</span>
                      <span className="flex items-center gap-1 text-xs">
                        {unsaved > 0 && <span className="h-2 w-2 rounded-full bg-blue-500" title="Saqlanmagan o'zgarish" />}
                        {changed > 0 && <span className="text-amber-600" title="O'zgartirilgan">{changed}✎</span>}
                        <span className="text-gray-400">{items.length}</span>
                      </span>
                    </button>
                  );
                })}
              </nav>

              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative min-w-[220px] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <Input placeholder="Matn yoki nom bo'yicha qidirish..." value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} className="rounded border-gray-300" />
                    Faqat o'zgartirilganlar
                  </label>
                </div>

                {group !== "all" && groupOf(group) && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-gray-500">{groupOf(group)!.description}</p>
                    {groupSwitch(group)}
                  </div>
                )}

                {dirtyKeys.length > 0 && (
                  <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800 shadow-sm">
                    <span>{dirtyKeys.length} ta saqlanmagan o'zgarish</span>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setDrafts({})}>
                        Hammasini bekor qilish
                      </Button>
                      <Button size="sm" loading={saving === "all"} onClick={() => void save(dirtyKeys)}>
                        Hammasini saqlash
                      </Button>
                    </div>
                  </div>
                )}

                {visible.length === 0 ? (
                  <EmptyState title="Matn topilmadi" hint="Qidiruv yoki filtrni o'zgartirib ko'ring" />
                ) : (
                  visible.map((item) => (
                    <div key={item.key}>
                      {group === "all" && !q && (visible[visible.indexOf(item) - 1]?.group !== item.group) && (
                        <h2 className="mb-2 mt-4 flex flex-wrap items-center justify-between gap-2 text-sm font-semibold uppercase tracking-wide text-gray-500 first:mt-0">
                          {groupOf(item.group)?.title}
                          {groupSwitch(item.group)}
                        </h2>
                      )}
                      <TextEditor
                        item={item}
                        value={drafts[item.key] ?? item.value}
                        saving={saving === item.key}
                        toggling={toggling !== null}
                        onToggle={(v) => void toggle(item.key, v)}
                        onChange={(v) => setDrafts((d) => ({ ...d, [item.key]: v }))}
                        onSave={() => void save([item.key])}
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          )
        }
      </AsyncView>
    </>
  );
}
