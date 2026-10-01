import { useState } from "react";
import { ArrowDown, ArrowUp, Bot, Pencil, Trash2 } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { api, errorMessage } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import type { Lesson, LessonCourse } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { AsyncView, Badge, Button, Card, ConfirmModal, EmptyState, Field, Input, Modal, PageHeader, Select, Table, Td, Textarea, Th } from "../components/ui";

function fmtDuration(s: number | null): string | null {
  if (s === null) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function fmtSize(bytes: string | null): string | null {
  if (!bytes) return null;
  const mb = Number(bytes) / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

interface EditState {
  lesson: Lesson;
  title: string;
  caption: string;
}

/**
 * Kurs darslari (videolar). Video botga yuboriladi yoki forward qilinadi (Telegram file_id saqlanadi) —
 * bu sahifa nom/izoh, tartib va o'chirishni boshqaradi.
 */
export default function LessonsPage() {
  const toast = useToast();
  const [productId, setProductId] = useState("");
  const [edit, setEdit] = useState<EditState | null>(null);
  const [removing, setRemoving] = useState<Lesson | null>(null);
  const [busy, setBusy] = useState(false);

  const courses = useAsync(() => api.get<{ items: LessonCourse[] }>("/lessons/courses").then((r) => r.data.items), []);
  const lessons = useAsync(
    () => api.get<{ items: Lesson[] }>("/lessons", { params: { productId: productId || undefined } }).then((r) => r.data.items),
    [productId],
  );

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      lessons.reload();
      courses.reload();
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** Kurs ichida bir pog'ona siljitish: kursning to'liq yangi tartibi yuboriladi */
  const move = (lesson: Lesson, dir: -1 | 1) => {
    const list = (lessons.data ?? []).filter((l) => l.productId === lesson.productId);
    const i = list.findIndex((l) => l.id === lesson.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const ids = list.map((l) => l.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void act(() => api.post("/lessons/reorder", { productId: lesson.productId, ids }), "Tartib saqlandi");
  };

  const saveEdit = async () => {
    if (!edit) return;
    const ok = await act(() => api.put(`/lessons/${edit.lesson.id}`, { title: edit.title, caption: edit.caption }), "Saqlandi");
    if (ok) setEdit(null);
  };

  return (
    <>
      <PageHeader title="Darslar (videolar)" subtitle="Kurs videolari Telegram'da saqlanadi (file_id) — xaridorlarga bot orqali yuboriladi" />

      <Card className="mb-4">
        <div className="flex items-start gap-3 p-4 text-sm text-gray-700">
          <Bot className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
          <div>
            <div className="font-medium text-gray-900">Video qanday qo'shiladi?</div>
            Botda videoni yuboring yoki Telegram kanal/chatdagi videoni botga <b>forward</b> qiling → kursni tanlang → dars nomini yozing. Bot
            menyusida: <b>🛠 Admin panel → 🎥 Darslar</b>. Video serverga yuklab olinmaydi va ilovada hajm cheklovi yo'q (Telegram qabul qilgan video
            — 2 GB gacha, Premium hisobdan 4 GB gacha).
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row sm:items-center">
          <Select className="sm:w-80" value={productId} onChange={(e) => setProductId(e.target.value)} aria-label="Kurs">
            <option value="">Barcha kurslar</option>
            {(courses.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} ({c.lessons})
              </option>
            ))}
          </Select>
        </div>
        <AsyncView state={lessons}>
          {(items) =>
            items.length === 0 ? (
              <EmptyState title="Darslar yo'q" hint="Videoni botga yuboring yoki forward qiling — u shu yerda paydo bo'ladi" />
            ) : (
              <Table
                head={
                  <tr>
                    <Th>Kurs</Th>
                    <Th>Dars nomi</Th>
                    <Th>Video</Th>
                    <Th>Tartib</Th>
                    <Th className="hidden md:table-cell">Qo'shilgan sana</Th>
                    <Th />
                  </tr>
                }
              >
                {items.map((l) => {
                  const siblings = items.filter((x) => x.productId === l.productId);
                  const pos = siblings.findIndex((x) => x.id === l.id);
                  const meta = [fmtDuration(l.duration), fmtSize(l.fileSize), l.width && l.height ? `${l.width}×${l.height}` : null].filter(Boolean).join(" · ");
                  return (
                    <tr key={l.id} className="hover:bg-gray-50">
                      <Td className="text-gray-700">{l.product.title}</Td>
                      <Td>
                        <div className="font-medium text-gray-900">{l.title}</div>
                        {l.caption && <div className="mt-0.5 line-clamp-2 max-w-md text-xs text-gray-500">{l.caption}</div>}
                      </Td>
                      <Td className="whitespace-nowrap text-gray-600">
                        <Badge tone={l.mediaType === "video" ? "blue" : "gray"}>{l.mediaType === "video" ? "Video" : "Video-fayl"}</Badge>
                        {meta && <div className="mt-1 text-xs text-gray-500">{meta}</div>}
                        {l.fileName && <div className="max-w-[12rem] truncate text-xs text-gray-400">{l.fileName}</div>}
                      </Td>
                      <Td className="whitespace-nowrap">
                        <span className="mr-2 inline-block w-6 text-right font-mono text-gray-700">{pos + 1}</span>
                        <Button variant="ghost" size="sm" aria-label="Yuqoriga" disabled={busy || pos === 0} onClick={() => move(l, -1)}>
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" aria-label="Pastga" disabled={busy || pos === siblings.length - 1} onClick={() => move(l, 1)}>
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </Td>
                      <Td className="hidden whitespace-nowrap text-gray-500 md:table-cell">{fmtDateTime(l.createdAt)}</Td>
                      <Td className="whitespace-nowrap text-right">
                        <Button variant="ghost" size="sm" aria-label="Tahrirlash" onClick={() => setEdit({ lesson: l, title: l.title, caption: l.caption ?? "" })}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" aria-label="O'chirish" className="text-red-600" onClick={() => setRemoving(l)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </Td>
                    </tr>
                  );
                })}
              </Table>
            )
          }
        </AsyncView>
      </Card>

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title="Darsni tahrirlash"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEdit(null)} disabled={busy}>
              Bekor qilish
            </Button>
            <Button onClick={() => void saveEdit()} loading={busy} disabled={!edit?.title.trim()}>
              Saqlash
            </Button>
          </>
        }
      >
        {edit && (
          <div className="space-y-4">
            <Field label="Dars nomi">
              <Input value={edit.title} maxLength={200} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            </Field>
            <Field label="Izoh (caption)" hint="Video bilan birga yuboriladi. Bo'sh qoldirsangiz — faqat nom chiqadi">
              <Textarea rows={5} maxLength={900} value={edit.caption} onChange={(e) => setEdit({ ...edit, caption: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={!!removing}
        title="Darsni o'chirish"
        danger
        confirmText="O'chirish"
        loading={busy}
        message={
          <>
            <b>{removing?.title}</b> darsi o'chiriladi. Xaridorlar bu videoni endi ko'ra olmaydi (Telegram'dagi asl xabar o'chmaydi).
          </>
        }
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) return;
          void act(() => api.delete(`/lessons/${removing.id}`), "Dars o'chirildi").then((ok) => ok && setRemoving(null));
        }}
      />
    </>
  );
}
