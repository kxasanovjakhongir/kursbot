import { useEffect, useState, type FormEvent } from "react";
import { Copy, Film, Pencil, Trash2, Upload } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { api, errorMessage } from "../lib/api";
import { fmtSum } from "../lib/format";
import type { Product } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { AsyncView, Badge, Button, Card, ConfirmModal, Field, Input, Modal, PageHeader, Textarea, Toggle } from "../components/ui";

interface ProductsResponse {
  items: Product[];
  botUsername: string | null;
}

interface FormState {
  id: number;
  title: string;
  description: string;
  price: string;
  oldPrice: string;
  channelId: string;
  isActive: boolean;
  type: Product["type"];
}

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
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      await api.put(`/products/${form.id}`, {
        title: form.title,
        description: form.description,
        price: Number(digits(form.price) || 0),
        oldPrice: digits(form.oldPrice) ? Number(digits(form.oldPrice)) : null,
        ...(form.type === "channel" ? { channelId: form.channelId.trim() || null } : {}),
        isActive: form.isActive,
      });
      toast.success("Mahsulot saqlandi");
      setForm(null);
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => toast.success("Havola nusxalandi"));
  };

  return (
    <>
      <PageHeader title="Mahsulotlar" subtitle="Narx, tavsif, yopiq kanal va telefon yuborilgandan keyin keladigan tanishtiruv videosi" />
      <AsyncView state={list}>
        {({ items, botUsername }) => (
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
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setForm({
                          id: p.id,
                          title: p.title,
                          description: p.description,
                          price: p.price ? String(p.price) : "",
                          oldPrice: p.oldPrice ? String(p.oldPrice) : "",
                          channelId: p.channelId ?? "",
                          isActive: p.isActive,
                          type: p.type,
                        })
                      }
                    >
                      <Pencil className="h-3.5 w-3.5" /> Tahrirlash
                    </Button>
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
        )}
      </AsyncView>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title="Mahsulotni tahrirlash"
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
              <Field label="Yopiq kanal ID" hint="-100 bilan boshlanadi. Bot kanalda admin bo'lishi kerak">
                <Input value={form.channelId} onChange={(e) => setForm({ ...form, channelId: e.target.value })} placeholder="-1001234567890" className="font-mono" />
              </Field>
            )}
            <div className="flex items-center gap-3">
              <Toggle checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label="Sotuvda" />
              <span className="text-sm text-gray-700">Sotuvda (botda ko'rinadi)</span>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
