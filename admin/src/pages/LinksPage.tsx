import { useState, type FormEvent } from "react";
import { Copy, Link2, Plus, Trash2 } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { api, errorMessage } from "../lib/api";
import { fmtDateTime, fmtNumber, fmtSum } from "../lib/format";
import type { CampaignLink, LinksMeta, Paged } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { AsyncView, Badge, Button, Card, ConfirmModal, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, Table, Td, Th, Toggle } from "../components/ui";

const SOURCES = ["instagram", "facebook", "tiktok", "telegram", "youtube", "google", "ads", "blogger", "other"];
const MEDIUMS = ["story", "reels", "post", "bio", "ads", "social", "direct"];

interface FormState {
  productId: string;
  name: string;
  source: string;
  campaign: string;
  medium: string;
  code: string;
}
const EMPTY: FormState = { productId: "", name: "", source: "instagram", campaign: "", medium: "", code: "" };

function CopyLink({ url, label }: { url: string; label: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => void navigator.clipboard.writeText(url).then(() => toast.success(`${label} nusxalandi`))}
      className="flex max-w-[260px] items-center gap-1.5 truncate text-left text-xs text-blue-600 hover:underline"
      title={url}
    >
      <Copy className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{url.replace("https://", "")}</span>
    </button>
  );
}

/** Kampaniya (deep link) havolalari: reklama uchun link yaratish, statistikani kuzatish */
export default function LinksPage() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [productId, setProductId] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "disabled">("all");
  const meta = useAsync(() => api.get<LinksMeta>("/links/meta").then((r) => r.data), []);
  const list = useAsync(
    () =>
      api
        .get<Paged<CampaignLink>>("/links", { params: { page, status, ...(productId ? { productId } : {}) } })
        .then((r) => r.data),
    [page, productId, status],
  );
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<CampaignLink["urls"] | null>(null);
  const [toDelete, setToDelete] = useState<CampaignLink | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      const res = await api.post<{ urls: CampaignLink["urls"] }>("/links", {
        productId: Number(form.productId),
        name: form.name.trim() || null,
        source: form.source,
        campaign: form.campaign.trim() || null,
        medium: form.medium.trim() || null,
        code: form.code.trim() || null,
      });
      toast.success("Link yaratildi");
      setForm(null);
      setCreated(res.data.urls);
      setPage(1);
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (l: CampaignLink) => {
    try {
      await api.patch(`/links/${l.id}`, { isActive: !l.isActive });
      toast.success(l.isActive ? "Link o'chirildi — foydalanuvchiga «havola eskirgan» ko'rsatiladi" : "Link qayta yoqildi");
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      await api.delete(`/links/${toDelete.id}`);
      toast.success("Link o'chirildi");
      list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setToDelete(null);
    }
  };

  const products = meta.data?.products ?? [];

  return (
    <>
      <PageHeader
        title="Kampaniya linklari"
        subtitle="Reklama (Instagram, TikTok, …) uchun darslikka olib boradigan link: bot va Mini App shu darslikni ochadi, kirishlar va buyurtmalar hisoblanadi"
        action={
          <Button onClick={() => setForm({ ...EMPTY, productId: products[0] ? String(products[0].id) : "" })} disabled={products.length === 0}>
            <Plus className="h-4 w-4" /> Link yaratish
          </Button>
        }
      />

      <Card>
        <div className="grid gap-3 border-b border-gray-100 p-4 sm:max-w-xl sm:grid-cols-2">
          <Select value={productId} onChange={(e) => (setProductId(e.target.value), setPage(1))}>
            <option value="">Barcha mahsulotlar</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => (setStatus(e.target.value === "active" || e.target.value === "disabled" ? e.target.value : "all"), setPage(1))}>
            <option value="all">Hammasi</option>
            <option value="active">Faol</option>
            <option value="disabled">O'chirilgan</option>
          </Select>
        </div>
        <AsyncView state={list}>
          {(d) =>
            d.items.length === 0 ? (
              <EmptyState title="Linklar yo'q" hint="Reklama uchun birinchi linkni yarating" />
            ) : (
              <>
                <Table
                  head={
                    <tr>
                      <Th>Link / mahsulot</Th>
                      <Th>Manba</Th>
                      <Th className="text-right" title="Unique bosishlar (tracking link orqali)">Bosish</Th>
                      <Th className="text-right" title="Link orqali botga yoki Mini App'ga kirgan unique foydalanuvchilar">Kirgan</Th>
                      <Th className="text-right" title="Telefon raqamini ulashgan">Ro'yxat</Th>
                      <Th className="text-right" title="Kurs ma'lumotini ko'rgan">Ko'rgan</Th>
                      <Th className="text-right">Buyurtma</Th>
                      <Th className="text-right">Xarid</Th>
                      <Th className="text-right" title="Xaridorlar / kirganlar">Konv.</Th>
                      <Th title="Yoqish/o'chirish va o'chirib tashlash">Holat</Th>
                    </tr>
                  }
                >
                  {d.items.map((l) => (
                    <tr key={l.id} className={l.isActive ? "hover:bg-gray-50" : "bg-gray-50/60 text-gray-400"}>
                      <Td>
                        {l.name && <div className="text-sm font-medium text-gray-900">{l.name}</div>}
                        <div className="font-mono text-xs text-gray-500">{l.code}</div>
                        {l.urls.tracked && <CopyLink url={l.urls.tracked} label="Tracking link" />}
                        {l.urls.bot && <CopyLink url={l.urls.bot} label="Bot linki" />}
                        {l.urls.app && <CopyLink url={l.urls.app} label="Mini App linki" />}
                        <div className="mt-1 text-xs text-gray-700">
                          📚 {l.product.title} {!l.product.isActive && <Badge tone="yellow">nofaol</Badge>}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-400">
                          {fmtDateTime(l.createdAt)}
                          {l.createdBy ? ` · ${l.createdBy.name}` : ""}
                        </div>
                      </Td>
                      <Td>
                        <Badge tone="blue">{l.source}</Badge>
                        {l.medium && <span className="ml-1 text-xs text-gray-500">{l.medium}</span>}
                        {l.campaign && <div className="mt-1 text-xs text-gray-600">{l.campaign}</div>}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {fmtNumber(l.stats?.uniqueClicks ?? 0)}
                        {!!l.stats?.clicks && l.stats.clicks !== l.stats.uniqueClicks && <div className="text-xs text-gray-400">jami: {fmtNumber(l.stats.clicks)}</div>}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {fmtNumber(l.stats?.users ?? 0)}
                        {!!l.stats?.newUsers && <div className="text-xs text-gray-400">yangi: {fmtNumber(l.stats.newUsers)}</div>}
                      </Td>
                      <Td className="text-right tabular-nums">{fmtNumber(l.stats?.registered ?? 0)}</Td>
                      <Td className="text-right tabular-nums">{fmtNumber(l.stats?.viewed ?? 0)}</Td>
                      <Td className="text-right tabular-nums">{fmtNumber(l.stats?.orders ?? 0)}</Td>
                      <Td className="text-right tabular-nums">
                        {fmtNumber(l.stats?.buyers ?? 0)}
                        {!!l.stats?.revenue && <div className="whitespace-nowrap text-xs text-gray-400">{fmtSum(l.stats.revenue)}</div>}
                      </Td>
                      <Td className="text-right tabular-nums">{(l.stats?.conversion ?? 0).toFixed(2)}%</Td>
                      <Td>
                        <div className="flex items-center gap-1">
                          <Toggle checked={l.isActive} onChange={() => void toggle(l)} label={l.isActive ? "O'chirish" : "Yoqish"} />
                          <Button variant="ghost" size="sm" onClick={() => setToDelete(l)} aria-label={`${l.code} — o'chirib tashlash`}>
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </Table>
                <Pagination page={d.page} pages={d.pages} total={d.total} onPage={setPage} />
              </>
            )
          }
        </AsyncView>
      </Card>

      <p className="mt-3 text-xs text-gray-500">
        Konversiya = to'lov qilganlar / link orqali kelgan foydalanuvchilar. Buyurtma link orqali kirgandan keyin 30 kun ichida bo'lsa shu linkka yoziladi. Bir
        foydalanuvchining 30 daqiqa ichidagi takroriy bosishlari bitta kirish hisoblanadi.
      </p>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title="Kampaniya linki yaratish"
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              Bekor qilish
            </Button>
            <Button type="submit" form="link-form" loading={saving}>
              Yaratish
            </Button>
          </>
        }
      >
        {form && (
          <form id="link-form" onSubmit={save} className="space-y-4">
            <Field label="Link nomi (ixtiyoriy)" hint="Masalan: Instagram story — sentabr">
              <Input maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Mahsulot (darslik)">
              <Select required value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                    {p.isActive ? "" : " (nofaol)"}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Manba (source)" hint="Qayerda joylanadi">
                <Input required list="link-sources" maxLength={40} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
                <datalist id="link-sources">
                  {SOURCES.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </Field>
              <Field label="Medium (ixtiyoriy)" hint="Joylashuv turi">
                <Input list="link-mediums" maxLength={40} value={form.medium} onChange={(e) => setForm({ ...form, medium: e.target.value })} placeholder="story" />
                <datalist id="link-mediums">
                  {MEDIUMS.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </Field>
            </div>
            <Field label="Kampaniya (ixtiyoriy)" hint="Masalan: Sentabr 2026, bloger nomi">
              <Input maxLength={80} value={form.campaign} onChange={(e) => setForm({ ...form, campaign: e.target.value })} />
            </Field>
            <Field label="Kod (ixtiyoriy)" hint="Bo'sh qoldirilsa qisqa kod avtomatik yaratiladi (masalan c7k2m9x). O'zingiz: 3–32 ta kichik lotin harfi, raqam yoki «-»">
              <Input
                maxLength={32}
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                placeholder="avtomatik"
                className="font-mono"
              />
            </Field>
            {meta.data && !meta.data.appLinks && (
              <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                Mini App linki (…?startapp=kod) uchun .env ga WEB_APP_SHORT_NAME (BotFather'dagi Mini App qisqa nomi) ni yozing. Bot linki baribir ishlaydi va
                undagi tugma Mini App'ni shu darslik sahifasida ochadi.
              </p>
            )}
          </form>
        )}
      </Modal>

      <Modal open={!!created} onClose={() => setCreated(null)} title="Link tayyor" footer={<Button onClick={() => setCreated(null)}>Yopish</Button>}>
        {created && (
          <div className="space-y-3 text-sm">
            {created.tracked && (
              <>
                <p className="flex items-center gap-2 font-medium text-gray-800">
                  <Link2 className="h-4 w-4" /> Tracking link — reklama uchun (bosishlar ham sanaladi)
                </p>
                <CopyLink url={created.tracked} label="Tracking link" />
              </>
            )}
            {created.bot ? (
              <>
                <p className="mt-2 font-medium text-gray-800">To'g'ridan-to'g'ri bot linki (bosishlar sanalmaydi)</p>
                <CopyLink url={created.bot} label="Bot linki" />
              </>
            ) : (
              <p className="text-red-600">Bot username aniqlanmadi — bot tokenini tekshiring</p>
            )}
            {created.app && (
              <>
                <p className="mt-2 font-medium text-gray-800">Mini App linki (to'g'ridan-to'g'ri ilova)</p>
                <CopyLink url={created.app} label="Mini App linki" />
              </>
            )}
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={!!toDelete}
        danger
        loading={busy}
        title="Linkni o'chirish"
        confirmText="O'chirish"
        onClose={() => setToDelete(null)}
        onConfirm={() => void remove()}
        message={`«${toDelete?.code ?? ""}» butunlay o'chiriladi. Agar link orqali kirishlar bo'lsa, statistika saqlanishi uchun o'chirilmaydi — bunday holda uni faolsizlantiring.`}
      />
    </>
  );
}
