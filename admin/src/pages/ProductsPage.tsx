import { useEffect, useState, type FormEvent } from "react";
import { Copy, Film, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { api, errorMessage } from "../lib/api";
import { fmtSum } from "../lib/format";
import type { Product } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { AsyncView, Badge, Button, Card, ConfirmModal, EmptyState, Field, Input, Modal, PageHeader, Textarea, Toggle } from "../components/ui";

interface ProductsResponse {
  items: Product[];
  botUsername: string | null;
}

interface KnownChannel {
  id: string;
  title: string;
  username?: string;
}

interface FormState {
  /** null — yangi mahsulot */
  id: number | null;
  code: string;
  title: string;
  description: string;
  price: string;
  oldPrice: string;
  channelId: string;
  isActive: boolean;
  type: Product["type"];
  bundleCodes: string[];
  accessDays: string;
  duration: string;
  lessonsCount: string;
  audience: string;
  startDate: string;
  teacher: string;
  benefits: string;
  program: string;
}

const COURSE_EMPTY = { duration: "", lessonsCount: "", audience: "", startDate: "", teacher: "", benefits: "", program: "" };

const EMPTY_FORM: FormState = {
  id: null,
  code: "",
  title: "",
  description: "",
  price: "",
  oldPrice: "",
  channelId: "",
  isActive: false,
  type: "channel",
  bundleCodes: [],
  accessDays: "",
  ...COURSE_EMPTY,
};

const digits = (s: string) => s.replace(/\D/g, "");

/** Videoni JWT bilan yuklab ko'rsatadi */
function VideoPreview({ productId, version }: { productId: number; version: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    let objectUrl: string | null = null;
    setError(null);
    api
      .get<Blob>(`/products/${productId}/video`, { responseType: "blob", timeout: 120_000 })
      .then((r) => {
        objectUrl = URL.createObjectURL(r.data);
        setUrl(objectUrl);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, productId, version]);

  if (!open)
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Film className="h-4 w-4" /> Videoni ko'rish
      </Button>
    );
  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!url) return <p className="text-xs text-gray-500">Video yuklanmoqda…</p>;
  return <video src={url} controls className="max-h-64 w-full rounded-lg bg-black" />;
}

function VideoUpload({ product, onDone }: { product: Product; onDone: () => void }) {
  const toast = useToast();
  const [progress, setProgress] = useState<number | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);

  const upload = async (file: File) => {
    if (file.size > 50 * 1024 * 1024) return toast.error("Video 50 MB dan oshmasligi kerak (Telegram limiti)");
    const form = new FormData();
    form.append("video", file);
    setProgress(0);
    try {
      await api.post(`/products/${product.id}/video`, form, {
        timeout: 10 * 60_000,
        onUploadProgress: (e) => setProgress(e.total ? Math.round((e.loaded / e.total) * 100) : null),
      });
      toast.success(`${product.title}: video yangilandi. Endi mijozlar shu videoni oladi`);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setProgress(null);
    }
  };

  const remove = async () => {
    try {
      await api.delete(`/products/${product.id}/video`);
      toast.success("Video olib tashlandi");
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRemoveOpen(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {product.videoFileId ? <Badge tone="green">Video yuklangan</Badge> : <Badge tone="yellow">Video yo'q</Badge>}
        <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 ${progress !== null ? "pointer-events-none opacity-60" : ""}`}>
          <Upload className="h-3.5 w-3.5" />
          {progress !== null ? `Yuklanmoqda… ${progress}%` : product.videoFileId ? "Videoni almashtirish" : "Video yuklash"}
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
        </label>
        {product.videoFileId && (
          <Button variant="ghost" size="sm" onClick={() => setRemoveOpen(true)} aria-label="Videoni olib tashlash">
            <Trash2 className="h-4 w-4 text-red-600" />
          </Button>
        )}
      </div>
      {progress !== null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
      {product.videoFileId && <VideoPreview productId={product.id} version={product.videoFileId} />}
      <ConfirmModal
        open={removeOpen}
        title="Videoni olib tashlash"
        danger
        confirmText="Olib tashlash"
        onClose={() => setRemoveOpen(false)}
        onConfirm={() => void remove()}
        message="Video olib tashlansa, mijozlarga faqat matnli tavsif yuboriladi."
      />
    </div>
  );
}

export default function ProductsPage() {
  const toast = useToast();
  const list = useAsync(() => api.get<ProductsResponse>("/products").then((r) => r.data), []);
  const channels = useAsync(() => api.get<{ items: KnownChannel[] }>("/products/channels").then((r) => r.data.items), []);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<Product | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const openForm = (next: FormState) => {
    channels.reload();
    setForm(next);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const common = {
      title: form.title,
      description: form.description,
      price: Number(digits(form.price) || 0),
      oldPrice: digits(form.oldPrice) ? Number(digits(form.oldPrice)) : null,
      ...(form.type === "channel" ? { channelId: form.channelId.trim() || null } : {}),
      isActive: form.isActive,
      accessDays: Number(digits(form.accessDays)) || null,
      // Kurs ma'lumotlari: bo'sh maydon — tozalanadi
      duration: form.duration.trim() || null,
      lessonsCount: Number(digits(form.lessonsCount)) || null,
      audience: form.audience.trim() || null,
      startDate: form.startDate || null,
      teacher: form.teacher.trim() || null,
      benefits: form.benefits.trim() || null,
      program: form.program.trim() || null,
    };
    if (form.id === null && form.type === "bundle" && form.bundleCodes.length < 2) {
      toast.error("To'plamga kamida 2 ta mahsulotni tanlang");
      return;
    }
    setSaving(true);
    try {
      if (form.id === null) {
        await api.post("/products", { ...common, code: form.code, type: form.type, ...(form.type === "bundle" ? { bundleCodes: form.bundleCodes } : {}) });
        toast.success("Mahsulot qo'shildi");
      } else {
        await api.put(`/products/${form.id}`, common);
        toast.success("Mahsulot saqlandi");
      }
      setForm(null);
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await api.delete(`/products/${removing.id}`);
      toast.success(`${removing.title} o'chirildi`);
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRemoveBusy(false);
      setRemoving(null);
    }
  };

  const channelProducts = (list.data?.items ?? []).filter((p) => p.type === "channel");

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => toast.success("Havola nusxalandi"));
  };

  return (
    <>
      <PageHeader
        title="Mahsulotlar"
        subtitle="Narx, tavsif, yopiq kanal va telefon yuborilgandan keyin keladigan tanishtiruv videosi"
        action={
          <Button onClick={() => openForm(EMPTY_FORM)}>
            <Plus className="h-4 w-4" /> Yangi mahsulot
          </Button>
        }
      />
      <AsyncView state={list}>
        {({ items, botUsername }) =>
          items.length === 0 ? (
            <EmptyState
              title="Hozircha mahsulot yo'q"
              hint="Birinchi darslikni qo'shing — u botda va Mini App'da ko'rinadi"
              action={<Button onClick={() => openForm(EMPTY_FORM)}>Yangi mahsulot</Button>}
            />
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              {items.map((p) => {
                const link = botUsername ? `https://t.me/${botUsername}?start=${p.code}_instagram` : null;
                return (
                  <Card key={p.id} className="flex flex-col">
                    <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-semibold text-gray-900">{p.title}</h2>
                          {p.isActive ? <Badge tone="green">Sotuvda</Badge> : <Badge tone="gray">Nofaol</Badge>}
                        </div>
                        <p className="mt-0.5 font-mono text-xs text-gray-500">kod: {p.code}</p>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            openForm({
                              id: p.id,
                              code: p.code,
                              title: p.title,
                              description: p.description,
                              price: p.price ? String(p.price) : "",
                              oldPrice: p.oldPrice ? String(p.oldPrice) : "",
                              channelId: p.channelId ?? "",
                              isActive: p.isActive,
                              type: p.type,
                              bundleCodes: p.bundleCodes,
                            accessDays: p.accessDays ? String(p.accessDays) : "",
                            duration: p.duration ?? "",
                            lessonsCount: p.lessonsCount ? String(p.lessonsCount) : "",
                            audience: p.audience ?? "",
                            startDate: p.startDate ? p.startDate.slice(0, 10) : "",
                            teacher: p.teacher ?? "",
                            benefits: p.benefits ?? "",
                            program: p.program ?? "",
                            })
                          }
                        >
                          <Pencil className="h-3.5 w-3.5" /> Tahrirlash
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setRemoving(p)} aria-label={`${p.title} — o'chirish`}>
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-1 flex-col gap-4 p-5 text-sm">
                      <div className="flex flex-wrap items-baseline gap-2">
                        {p.price > 0 ? (
                          <>
                            {p.oldPrice && p.oldPrice > p.price && <span className="text-gray-400 line-through">{fmtSum(p.oldPrice)}</span>}
                            <span className="text-xl font-semibold text-gray-900">{fmtSum(p.price)}</span>
                          </>
                        ) : (
                          <Badge tone="red">Narx kiritilmagan — sotib bo'lmaydi</Badge>
                        )}
                      </div>
                      {p.description ? <p className="whitespace-pre-wrap text-gray-600">{p.description}</p> : <p className="text-gray-400">Tavsif yo'q</p>}
                      <div className="text-gray-600">
                        {p.type === "bundle" ? (
                          <>To'plam: {p.bundleCodes.join(" + ")}</>
                        ) : p.channelId ? (
                          <>
                            Kanal: <span className="font-mono">{p.channelId}</span>
                          </>
                        ) : (
                          <Badge tone="yellow">Kanal ID kiritilmagan — tasdiqlashda link yaratilmaydi</Badge>
                        )}
                      </div>
                      <p className="text-gray-600">Kanalda qolish: {p.accessDays ? `${p.accessDays} kun` : "muddatsiz"}</p>
                      {link && (
                        <button onClick={() => copy(link)} className="flex items-center gap-2 truncate text-left text-xs text-blue-600 hover:underline">
                          <Copy className="h-3.5 w-3.5 shrink-0" /> {link}
                        </button>
                      )}
                      <div className="mt-auto border-t border-gray-100 pt-4">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Tanishtiruv videosi</p>
                        <VideoUpload product={p} onDone={list.reload} />
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )
        }
      </AsyncView>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id === null ? "Yangi mahsulot" : "Mahsulotni tahrirlash"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              Bekor qilish
            </Button>
            <Button type="submit" form="product-form" loading={saving}>
              Saqlash
            </Button>
          </>
        }
      >
        {form && (
          <form id="product-form" onSubmit={save} className="space-y-4">
            {form.id === null && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Kod" hint="Havolada ishlatiladi: t.me/bot?start=KOD_manba. Keyin o'zgartirib bo'lmaydi">
                  <Input
                    required
                    maxLength={20}
                    pattern="[a-z0-9\-]{1,20}"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                    placeholder="5b"
                    className="font-mono"
                  />
                </Field>
                <Field label="Turi">
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value === "bundle" ? "bundle" : "channel" })}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="channel">Darslik (yopiq kanal)</option>
                    <option value="bundle">To'plam (bir nechta darslik)</option>
                  </select>
                </Field>
              </div>
            )}
            <Field label="Nomi">
              <Input required maxLength={100} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field label="Tavsif" hint="Video ostida ko'rinadi">
              <Textarea rows={4} maxLength={900} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Narx (so'm)" hint="Ochiq buyurtmalar eski narxda qoladi">
                <Input inputMode="numeric" required value={form.price} onChange={(e) => setForm({ ...form, price: digits(e.target.value) })} placeholder="1250000" />
              </Field>
              <Field label="Eski narx (ixtiyoriy)" hint="Chegirmani ko'rsatish uchun">
                <Input inputMode="numeric" value={form.oldPrice} onChange={(e) => setForm({ ...form, oldPrice: digits(e.target.value) })} />
              </Field>
            </div>
            {form.type === "channel" && (
              <Field
                label="Yopiq kanal"
                hint="Kanal havolasi (https://t.me/+...), @username yoki ID (-100...). Avval botni kanalga admin qilib qo'shing"
              >
                <Input
                  list="known-channels"
                  value={form.channelId}
                  onChange={(e) => setForm({ ...form, channelId: e.target.value })}
                  placeholder="https://t.me/+AbCdEf... yoki -1001234567890"
                  className="font-mono"
                />
                <datalist id="known-channels">
                  {(channels.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </datalist>
              </Field>
            )}
            <details className="rounded-lg border border-gray-200 p-3" open={!!(form.duration || form.program || form.teacher)}>
              <summary className="cursor-pointer text-sm font-medium text-gray-800">Kurs ma'lumotlari (botda bo'lim tugmalari: Kurs haqida, Dastur, O'qituvchi)</summary>
              <div className="mt-3 space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Davomiyligi">
                    <Input maxLength={60} value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} placeholder="3 oy" />
                  </Field>
                  <Field label="Darslar soni">
                    <Input inputMode="numeric" maxLength={5} value={form.lessonsCount} onChange={(e) => setForm({ ...form, lessonsCount: digits(e.target.value) })} />
                  </Field>
                  <Field label="Boshlanish sanasi">
                    <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                  </Field>
                </div>
                <Field label="Kimlar uchun">
                  <Textarea rows={2} maxLength={600} value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} />
                </Field>
                <Field label="Afzalliklari">
                  <Textarea rows={3} maxLength={1500} value={form.benefits} onChange={(e) => setForm({ ...form, benefits: e.target.value })} />
                </Field>
                <Field label="Dastur" hint="Har bir mavzu yangi qatorda">
                  <Textarea rows={5} maxLength={3000} value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })} />
                </Field>
                <Field label="O'qituvchi">
                  <Textarea rows={3} maxLength={800} value={form.teacher} onChange={(e) => setForm({ ...form, teacher: e.target.value })} />
                </Field>
              </div>
            </details>
            <Field label="Kanalda qolish muddati (kun)" hint="Bo'sh — muddatsiz. Muddat tugasa, bot kanaldan avtomatik chiqaradi. Faqat yangi xaridlarga ta'sir qiladi">
              <Input inputMode="numeric" maxLength={4} value={form.accessDays} onChange={(e) => setForm({ ...form, accessDays: digits(e.target.value) })} placeholder="Muddatsiz" />
            </Field>
            {form.id === null && form.type === "bundle" && (
              <Field label="To'plam tarkibi" hint="Kamida 2 ta darslik. Mijoz to'plamni olsa, hammasining kanaliga kiradi">
                <div className="space-y-2 rounded-lg border border-gray-200 p-3">
                  {channelProducts.length === 0 && <p className="text-sm text-gray-500">Avval kanalli darsliklarni qo'shing</p>}
                  {channelProducts.map((p) => (
                    <label key={p.code} className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={form.bundleCodes.includes(p.code)}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            bundleCodes: e.target.checked ? [...form.bundleCodes, p.code] : form.bundleCodes.filter((c) => c !== p.code),
                          })
                        }
                      />
                      {p.title} <span className="font-mono text-xs text-gray-400">{p.code}</span>
                    </label>
                  ))}
                </div>
              </Field>
            )}
            <div className="flex items-center gap-3">
              <Toggle checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label="Sotuvda" />
              <span className="text-sm text-gray-700">Sotuvda (botda ko'rinadi)</span>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmModal
        open={!!removing}
        title="Mahsulotni o'chirish"
        danger
        loading={removeBusy}
        confirmText="O'chirish"
        onClose={() => setRemoving(null)}
        onConfirm={() => void remove()}
        message={
          <div className="space-y-2">
            <p>
              «{removing?.title ?? ""}» o'chiriladi: bot, Mini App va paneldan yo'qoladi, kampaniya linklari o'chiriladi.
            </p>
            <p className="text-gray-500">
              Buyurtmalar va tushum tarixi saqlanadi, sotib olganlarning kanalga kirishi ham saqlanadi. To'lanmagan ochiq buyurtmalar bekor qilinadi.
              Vaqtincha yashirish kerak bo'lsa — o'chirish o'rniga «Sotuvda» ni o'chiring.
            </p>
          </div>
        }
      />
    </>
  );
}
