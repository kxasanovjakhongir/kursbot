import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, Send, Upload } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { api, errorMessage } from "../lib/api";
import { fmtNumber } from "../lib/format";
import type { Audience, Broadcast, BotStatus, BroadcastType } from "../lib/types";
import { TelegramPreview } from "../components/TelegramPreview";
import { Button, Card, CardHeader, ConfirmModal, Field, PageHeader, Select, Textarea } from "../components/ui";

const TYPES: { value: BroadcastType; label: string; accept: string }[] = [
  { value: "text", label: "Matn", accept: "" },
  { value: "photo", label: "Rasm", accept: "image/jpeg,image/png,image/webp" },
  { value: "video", label: "Video", accept: "video/mp4,video/quicktime,video/webm" },
  { value: "document", label: "Hujjat", accept: "" },
];

const newKey = () => crypto.randomUUID();

export default function BroadcastPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [type, setType] = useState<BroadcastType>("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [audience, setAudience] = useState<Audience>("active");
  const [recipients, setRecipients] = useState("");
  const [showPreview, setShowPreview] = useState(true);
  const [confirm, setConfirm] = useState<{ count: number; notFound: string[] } | null>(null);
  const [counting, setCounting] = useState(false);
  const [sending, setSending] = useState(false);
  const [botName, setBotName] = useState("Bot");
  // Bitta forma = bitta kalit: tugma ikki marta bosilsa ham broadcast bitta bo'ladi
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);

  useEffect(() => {
    api.get<BotStatus>("/bot/status").then((r) => r.data.name && setBotName(r.data.name)).catch(() => undefined);
  }, []);

  const fileUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (fileUrl && URL.revokeObjectURL(fileUrl)), [fileUrl]);

  const captionLimit = type === "text" ? 4096 : 1024;
  const valid = (type === "text" ? text.trim().length > 0 : !!file) && text.length <= captionLimit && (audience !== "specific" || recipients.trim().length > 0);

  const askConfirm = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setCounting(true);
    try {
      const r = await api.get<{ count: number; notFound: string[] }>("/broadcast/recipients-count", {
        params: { audience, recipients: audience === "specific" ? recipients : undefined },
      });
      if (r.data.count === 0) return toast.error("Qabul qiluvchilar topilmadi");
      setConfirm(r.data);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setCounting(false);
    }
  };

  const send = async () => {
    setSending(true);
    try {
      const form = new FormData();
      form.append("messageType", type);
      if (text) form.append("text", text);
      form.append("audience", audience);
      if (audience === "specific") form.append("recipients", recipients);
      form.append("idempotencyKey", idempotencyKey);
      if (file && type !== "text") form.append("file", file);
      const r = await api.post<{ broadcast: Broadcast; created: boolean }>("/broadcast", form, { timeout: 120_000 });
      toast.success(r.data.created ? "Broadcast yuborilmoqda" : "Bu broadcast allaqachon yaratilgan");
      setIdempotencyKey(newKey());
      navigate(`/broadcast/${r.data.broadcast.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSending(false);
      setConfirm(null);
    }
  };

  const accept = TYPES.find((t) => t.value === type)?.accept;

  return (
    <>
      <PageHeader title="Broadcast" subtitle="Bot foydalanuvchilariga ommaviy xabar yuborish" />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Yangi xabar" />
          <form onSubmit={askConfirm} className="space-y-5 p-5">
            <Field label="Xabar turi">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => {
                      setType(t.value);
                      setFile(null);
                    }}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                      type === t.value ? "border-blue-600 bg-blue-50 text-blue-700" : "border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </Field>

            {type !== "text" && (
              <Field label="Fayl" hint="50 MB gacha">
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-gray-300 px-4 py-4 text-sm text-gray-600 hover:border-blue-400 hover:bg-blue-50/40">
                  <Upload className="h-5 w-5 text-gray-400" />
                  <span className="truncate">{file ? `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)` : "Faylni tanlang"}</span>
                  <input type="file" className="sr-only" accept={accept || undefined} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </label>
              </Field>
            )}

            <Field label={type === "text" ? "Xabar matni" : "Izoh (caption, ixtiyoriy)"} hint={`${text.length} / ${captionLimit}`} error={text.length > captionLimit ? "Juda uzun" : undefined}>
              <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Assalomu alaykum! Bugun yangi xizmatlarimiz ishga tushdi." />
            </Field>

            <Field label="Qabul qiluvchilar">
              <Select value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
                <option value="active">Faol foydalanuvchilar (botni bloklamaganlar)</option>
                <option value="all">Barcha foydalanuvchilar (bloklaganlar o'tkazib yuboriladi)</option>
                <option value="specific">Tanlangan foydalanuvchilar</option>
              </Select>
            </Field>
            {audience === "specific" && (
              <Field label="Telegram ID yoki @username" hint="Har birini yangi qatorda yoki vergul bilan">
                <Textarea rows={3} value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder={"5046885620\n@username"} />
              </Field>
            )}

            <div className="flex flex-wrap gap-3 pt-1">
              <Button type="button" variant="secondary" onClick={() => setShowPreview((v) => !v)}>
                <Eye className="h-4 w-4" /> {showPreview ? "Previewni yashirish" : "Preview"}
              </Button>
              <Button type="submit" disabled={!valid} loading={counting}>
                <Send className="h-4 w-4" /> Broadcast yuborish
              </Button>
            </div>
          </form>
        </Card>

        {showPreview && (
          <Card className="h-fit lg:col-span-2">
            <CardHeader title="Preview" subtitle="Telegram'dagi ko'rinishi" />
            <div className="p-5">
              <TelegramPreview type={type} text={text} fileUrl={fileUrl} fileName={file?.name ?? null} botName={botName} />
            </div>
          </Card>
        )}
      </div>

      <ConfirmModal
        open={!!confirm}
        title="Broadcastni tasdiqlang"
        confirmText="Ha, yuborish"
        loading={sending}
        onClose={() => setConfirm(null)}
        onConfirm={() => void send()}
        message={
          confirm && (
            <div className="space-y-2">
              <p>
                Ushbu xabarni <b>{fmtNumber(confirm.count)}</b> ta foydalanuvchiga yuborishni tasdiqlaysizmi?
              </p>
              <p className="text-gray-500">Yuborilgan xabarni qaytarib olib bo'lmaydi.</p>
              {confirm.notFound.length > 0 && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">Topilmadi (o'tkazib yuboriladi): {confirm.notFound.join(", ")}</p>
              )}
            </div>
          )
        }
      />
    </>
  );
}
