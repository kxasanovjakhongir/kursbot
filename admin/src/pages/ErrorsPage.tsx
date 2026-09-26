import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCheck, CheckCircle2, RefreshCw, RotateCcw, Search, Trash2 } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { fmtDateTime, timeAgo } from "../lib/format";
import type { ErrorLogDetail, ErrorLogItem, Paged } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { useToast } from "../context/ToastContext";
import { usePending } from "../context/PendingContext";
import { AsyncView, Badge, Button, Card, ConfirmModal, EmptyState, Input, Modal, PageHeader, Pagination, Spinner } from "../components/ui";

type Status = "open" | "resolved" | "all";
type ErrorsPage = Paged<ErrorLogItem> & { counts: { open: number; resolved: number } };

/** Botdagi texnik xatolar: bot handlerlari, API, fon vazifalari, Telegram/baza xatolari */
export default function ErrorsPage() {
  const toast = useToast();
  const { refresh: refreshCounts } = usePending();
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") as Status | null) ?? "open";
  const q = params.get("q") ?? "";
  const page = Number(params.get("page") ?? 1);
  const [search, setSearch] = useState(q);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"resolve-all" | "delete-resolved" | null>(null);
  const [busy, setBusy] = useState(false);

  const list = useAsync(() => api.get<ErrorsPage>("/errors", { params: { status, q: q || undefined, page } }).then((r) => r.data), [status, q, page]);

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in patch)) next.delete("page");
    setParams(next);
  };
  const reload = () => {
    list.reload();
    refreshCounts();
  };
  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    set({ q: search.trim() });
  };

  const bulk = async () => {
    setBusy(true);
    try {
      const { data } =
        confirm === "resolve-all" ? await api.post<{ count: number }>("/errors/resolve-all") : await api.delete<{ count: number }>("/errors/resolved");
      toast.success(confirm === "resolve-all" ? `${data.count} ta xato hal qilindi deb belgilandi` : `${data.count} ta xato o'chirildi`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const counts = list.data?.counts;
  const tabs: { key: Status; label: string; count?: number }[] = [
    { key: "open", label: "Ochiq", count: counts?.open },
    { key: "resolved", label: "Hal qilingan", count: counts?.resolved },
    { key: "all", label: "Hammasi" },
  ];

  return (
    <>
      <PageHeader
        title="Xatoliklar"
        subtitle="Botdagi texnik muammolar. Bir xil xato bitta qatorga yig'iladi — necha marta va oxirgi marta qachon bo'lgani ko'rinadi"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={reload} loading={list.loading}>
              <RefreshCw className="h-4 w-4" /> Yangilash
            </Button>
            {status !== "resolved" && !!counts?.open && (
              <Button variant="secondary" onClick={() => setConfirm("resolve-all")}>
                <CheckCheck className="h-4 w-4" /> Hammasi hal qilindi
              </Button>
            )}
            {status === "resolved" && !!counts?.resolved && (
              <Button variant="secondary" onClick={() => setConfirm("delete-resolved")} className="text-red-600">
                <Trash2 className="h-4 w-4" /> Tozalash
              </Button>
            )}
          </div>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row sm:items-center">
          <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => set({ status: t.key === "open" ? "" : t.key })}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${status === t.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
              >
                {t.label}
                {t.count !== undefined && <span className="ml-1.5 tabular-nums text-gray-400">{t.count}</span>}
              </button>
            ))}
          </div>
          <form onSubmit={onSearch} className="flex flex-1 gap-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Xato matni bo'yicha qidirish" />
            <Button type="submit" variant="secondary">
              <Search className="h-4 w-4" />
            </Button>
          </form>
        </div>
        <AsyncView state={list}>
          {(d) =>
            d.items.length === 0 ? (
              <EmptyState
                title={status === "open" && !q ? "Ochiq xatolar yo'q ✅" : "Xatolar topilmadi"}
                hint={status === "open" && !q ? "Bot yoki serverda texnik muammo bo'lsa, shu yerda paydo bo'ladi" : undefined}
              />
            ) : (
              <>
                <ul className="divide-y divide-gray-100">
                  {d.items.map((e) => (
                    <li key={e.id}>
                      <button onClick={() => setOpenId(e.id)} className="flex w-full items-start gap-4 px-5 py-4 text-left hover:bg-gray-50">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={e.level === "fatal" ? "red" : e.resolvedAt ? "gray" : "yellow"}>{e.level === "fatal" ? "Jiddiy" : "Xato"}</Badge>
                            {e.resolvedAt && <Badge tone="green">Hal qilingan</Badge>}
                            <span className="font-medium text-gray-900">{e.message}</span>
                          </div>
                          {e.errorText && (
                            <p className="mt-1 truncate font-mono text-xs text-gray-600" title={e.errorText}>
                              {e.errorType ? `${e.errorType}: ` : ""}
                              {e.errorText}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 text-right text-xs text-gray-500">
                          <div className="text-sm font-semibold tabular-nums text-gray-900">{e.count}×</div>
                          <div title={fmtDateTime(e.lastSeenAt)}>{timeAgo(e.lastSeenAt)}</div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
                <Pagination page={d.page} pages={d.pages} total={d.total} onPage={(p) => set({ page: String(p) })} />
              </>
            )
          }
        </AsyncView>
      </Card>

      {openId && <ErrorDetailModal id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}

      <ConfirmModal
        open={!!confirm}
        title={confirm === "resolve-all" ? "Barcha ochiq xatolar hal qilindimi?" : "Hal qilingan xatolarni o'chirish"}
        message={
          confirm === "resolve-all"
            ? "Xatolar «Hal qilingan» bo'limiga o'tadi. Qaysidir biri qayta takrorlansa, yana «Ochiq» ga qaytadi."
            : "Hal qilingan barcha xatolar o'chiriladi. Takrorlansa, yangidan paydo bo'ladi."
        }
        confirmText={confirm === "resolve-all" ? "Ha, hal qilindi" : "O'chirish"}
        danger={confirm === "delete-resolved"}
        loading={busy}
        onConfirm={() => void bulk()}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}

function ErrorDetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const item = useAsync(() => api.get<ErrorLogDetail>(`/errors/${id}`).then((r) => r.data), [id]);
  const [busy, setBusy] = useState(false);

  const toggle = async (e: ErrorLogDetail) => {
    setBusy(true);
    try {
      await api.post(`/errors/${id}/${e.resolvedAt ? "reopen" : "resolve"}`);
      toast.success(e.resolvedAt ? "Xato qayta ochildi" : "Hal qilindi deb belgilandi");
      onChanged();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const e = item.data;
  return (
    <Modal
      open
      onClose={onClose}
      title="Xato tafsilotlari"
      footer={
        e && (
          <>
            <Button variant="secondary" onClick={onClose}>
              Yopish
            </Button>
            <Button variant={e.resolvedAt ? "secondary" : "primary"} onClick={() => void toggle(e)} loading={busy}>
              {e.resolvedAt ? (
                <>
                  <RotateCcw className="h-4 w-4" /> Qayta ochish
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" /> Hal qilindi
                </>
              )}
            </Button>
          </>
        )
      }
    >
      {!e ? (
        item.error ? <p className="text-sm text-red-600">{item.error}</p> : <Spinner />
      ) : (
        <div className="space-y-4 text-sm">
          <div>
            <div className="font-medium text-gray-900">{e.message}</div>
            {e.errorText && (
              <div className="mt-1 break-words font-mono text-xs text-red-700">
                {e.errorType ? `${e.errorType}: ` : ""}
                {e.errorText}
              </div>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-3 text-xs">
            <div>
              <dt className="text-gray-500">Necha marta</dt>
              <dd className="font-semibold text-gray-900">{e.count}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Daraja</dt>
              <dd className="font-semibold text-gray-900">{e.level === "fatal" ? "Jiddiy (server to'xtagan)" : "Xato"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Birinchi marta</dt>
              <dd className="text-gray-900">{fmtDateTime(e.firstSeenAt)}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Oxirgi marta</dt>
              <dd className="text-gray-900">{fmtDateTime(e.lastSeenAt)}</dd>
            </div>
          </dl>
          {e.context && Object.keys(e.context).length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Kontekst</div>
              <pre className="max-h-48 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">{JSON.stringify(e.context, null, 2)}</pre>
            </div>
          )}
          {e.stack && (
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Stack trace (dasturchi uchun)</div>
              <pre className="max-h-64 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">{e.stack}</pre>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
