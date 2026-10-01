import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, FileSpreadsheet, FileText, FileType2, Search, X } from "lucide-react";
import { api, downloadFile, errorMessage } from "../lib/api";
import { fmtDate, fmtSum, fullName, ORDER_STATUS, timeAgo } from "../lib/format";
import { useToast } from "../context/ToastContext";
import type { Paged, TelegramUser, UserFilters } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { useDebounced } from "../hooks/useDebounced";
import { UserStatus } from "../components/UserStatus";
import { AsyncView, Badge, Button, Card, EmptyState, Input, PageHeader, Pagination, Select, Table, Td, Th } from "../components/ui";

type Status = "all" | "active" | "blocked" | "banned";

interface Filters {
  status: Status;
  productId: string;
  source: string;
  campaign: string;
  purchased: "" | "yes" | "no";
  registered: "" | "yes" | "no";
  from: string;
  to: string;
  /** Shu kursni sotib olganlar */
  boughtProductId: string;
  /** To'lov (buyurtma) holati */
  paymentStatus: string;
}
const NO_FILTERS: Filters = { status: "all", productId: "", source: "", campaign: "", purchased: "", registered: "", from: "", to: "", boughtProductId: "", paymentStatus: "" };

type ExportFormat = "xlsx" | "docx" | "pdf";
const EXPORTS: { format: ExportFormat; label: string; icon: typeof FileText }[] = [
  { format: "xlsx", label: "Excel yuklab olish", icon: FileSpreadsheet },
  { format: "docx", label: "Word yuklab olish", icon: FileText },
  { format: "pdf", label: "PDF yuklab olish", icon: FileType2 },
];

/** "YYYY-MM-DD" (mahalliy kun) → shu kun boshi / keyingi kun boshi (ISO) */
const dayStart = (d: string) => new Date(`${d}T00:00:00`).toISOString();
const nextDayStart = (d: string) => new Date(new Date(`${d}T00:00:00`).getTime() + 86400_000).toISOString();

/** Ro'yxat va export uchun bir xil so'rov parametrlari (export aynan ko'rinib turgan filtr natijasi) */
function filterParams(f: Filters, q: string) {
  return {
    q: q || undefined,
    status: f.status,
    productId: f.productId || undefined,
    source: f.source || undefined,
    campaign: f.campaign || undefined,
    purchased: f.purchased || undefined,
    registered: f.registered || undefined,
    from: f.from ? dayStart(f.from) : undefined,
    to: f.to ? nextDayStart(f.to) : undefined,
    boughtProductId: f.boughtProductId || undefined,
    paymentStatus: f.paymentStatus || undefined,
  };
}

export default function TelegramUsersPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [q, setQ] = useState("");
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const options = useAsync(() => api.get<UserFilters>("/telegram-users/filters").then((r) => r.data), []);

  const update = (patch: Partial<Filters>) => {
    setF((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };
  const active = JSON.stringify(f) !== JSON.stringify(NO_FILTERS);

  const users = useAsync(
    () =>
      api
        .get<Paged<TelegramUser>>("/telegram-users", { params: { ...filterParams(f, dq), page } })
        .then((r) => r.data),
    [dq, f, page],
  );

  const runExport = async (format: ExportFormat) => {
    setExporting(format);
    try {
      await downloadFile(`/telegram-users/export/${format}`, filterParams(f, dq), `users.${format}`);
      toast.success("Fayl yuklab olindi");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Telegram foydalanuvchilar"
        subtitle="Qaysi kurs, manba va kampaniyadan kelgani, ro'yxatdan o'tgani va xaridlari"
        action={
          <div className="flex flex-wrap gap-2" title="Joriy filtrlar bo'yicha yuklab olinadi">
            {EXPORTS.map((e) => (
              <Button key={e.format} variant="secondary" size="sm" loading={exporting === e.format} disabled={exporting !== null} onClick={() => void runExport(e.format)}>
                {exporting !== e.format && <e.icon className="h-4 w-4" />} {e.label}
              </Button>
            ))}
          </div>
        }
      />
      <Card>
        <div className="space-y-3 border-b border-gray-100 p-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                className="pl-9"
                placeholder="Telegram ID, username, ism yoki telefon"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <Select className="sm:w-44" value={f.status} onChange={(e) => update({ status: e.target.value as Status })}>
              <option value="all">Barchasi</option>
              <option value="active">Faol</option>
              <option value="blocked">Botni bloklagan</option>
              <option value="banned">Cheklangan</option>
            </Select>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <Select value={f.productId} onChange={(e) => update({ productId: e.target.value })} aria-label="Qiziqqan kursi" title="Kurs linki orqali kelgan yoki oxirgi ko'rgan kursi">
              <option value="">Qiziqqan kursi: hammasi</option>
              {(options.data?.products ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </Select>
            <Select value={f.source} onChange={(e) => update({ source: e.target.value })} aria-label="Manba">
              <option value="">Barcha manbalar</option>
              {(options.data?.sources ?? []).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <Select value={f.campaign} onChange={(e) => update({ campaign: e.target.value })} aria-label="Kampaniya">
              <option value="">Barcha kampaniyalar</option>
              {(options.data?.campaigns ?? []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Select value={f.registered} onChange={(e) => update({ registered: e.target.value === "yes" || e.target.value === "no" ? e.target.value : "" })} aria-label="Ro'yxatdan o'tgan">
              <option value="">Ro'yxat: hammasi</option>
              <option value="yes">Ro'yxatdan o'tgan</option>
              <option value="no">O'tmagan</option>
            </Select>
            <Select value={f.purchased} onChange={(e) => update({ purchased: e.target.value === "yes" || e.target.value === "no" ? e.target.value : "" })} aria-label="Xarid">
              <option value="">Xarid: hammasi</option>
              <option value="yes">Sotib olgan</option>
              <option value="no">Sotib olmagan</option>
            </Select>
            <Select value={f.boughtProductId} onChange={(e) => update({ boughtProductId: e.target.value })} aria-label="Sotib olgan kursi">
              <option value="">Sotib olgan kursi: hammasi</option>
              {(options.data?.products ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </Select>
            <Select value={f.paymentStatus} onChange={(e) => update({ paymentStatus: e.target.value })} aria-label="To'lov holati">
              <option value="">To'lov holati: hammasi</option>
              {Object.entries(ORDER_STATUS).map(([value, s]) => (
                <option key={value} value={value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
            <span>Qo'shilgan:</span>
            <div className="w-44">
              <Input type="date" value={f.from} onChange={(e) => update({ from: e.target.value })} aria-label="Dan" />
            </div>
            <span className="text-gray-400">—</span>
            <div className="w-44">
              <Input type="date" value={f.to} onChange={(e) => update({ to: e.target.value })} aria-label="Gacha" />
            </div>
          </div>
          {active && (
            <Button variant="ghost" size="sm" onClick={() => update(NO_FILTERS)}>
              <X className="h-4 w-4" /> Filtrlarni tozalash
            </Button>
          )}
        </div>
        <AsyncView state={users}>
          {(d) =>
            d.items.length === 0 ? (
              <EmptyState title="Foydalanuvchilar topilmadi" hint={q || active ? "Qidiruv yoki filtrlarni o'zgartirib ko'ring" : undefined} />
            ) : (
              <>
                <div className="px-4 pt-3 text-xs text-gray-500">Topildi: {d.total}</div>
                <Table
                  head={
                    <tr>
                      <Th>Foydalanuvchi</Th>
                      <Th>Kurs</Th>
                      <Th title="Birinchi kelgan manba (first-touch)">Manba / kampaniya</Th>
                      <Th>Holat</Th>
                      <Th title="Telefon raqamini ulashgan">Ro'yxat</Th>
                      <Th>Xarid</Th>
                      <Th className="hidden md:table-cell">Qo'shilgan</Th>
                      <Th className="hidden md:table-cell">Oxirgi faollik</Th>
                      <Th />
                    </tr>
                  }
                >
                  {d.items.map((u) => (
                    <tr key={u.id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/telegram-users/${u.id}`)}>
                      <Td>
                        <div className="font-medium text-gray-900">{fullName(u)}</div>
                        <div className="text-xs text-gray-500">
                          {u.username ? `@${u.username} · ` : ""}
                          <span className="font-mono">{u.telegramId}</span>
                        </div>
                      </Td>
                      <Td className="text-gray-700">{u.firstLink?.product.title ?? u.lastProductTitle ?? <span className="text-gray-400">—</span>}</Td>
                      <Td>
                        {u.firstLink?.source ?? u.firstSource ? <Badge tone="blue">{u.firstLink?.source ?? u.firstSource}</Badge> : <span className="text-gray-400">—</span>}
                        {u.firstLink?.campaign && <div className="mt-1 text-xs text-gray-500">{u.firstLink.campaign}</div>}
                      </Td>
                      <Td>
                        <UserStatus user={u} />
                      </Td>
                      <Td className="whitespace-nowrap">
                        {u.phone ? <span className="text-green-700">✓ {u.registeredAt ? fmtDate(u.registeredAt) : ""}</span> : <span className="text-gray-400">—</span>}
                      </Td>
                      <Td className="whitespace-nowrap">
                        {u.purchase ? (
                          <>
                            <div className="font-medium text-gray-900">{fmtSum(u.purchase.amount)}</div>
                            <div className="text-xs text-gray-500">
                              {u.purchase.count} ta · {fmtDate(u.purchase.lastAt)}
                            </div>
                          </>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </Td>
                      <Td className="hidden whitespace-nowrap text-gray-500 md:table-cell">{fmtDate(u.createdAt)}</Td>
                      <Td className="hidden whitespace-nowrap text-gray-500 md:table-cell">{timeAgo(u.lastSeenAt)}</Td>
                      <Td>
                        <Link to={`/telegram-users/${u.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex text-blue-600 hover:text-blue-800" aria-label="Ko'rish">
                          <Eye className="h-4 w-4" />
                        </Link>
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
    </>
  );
}
