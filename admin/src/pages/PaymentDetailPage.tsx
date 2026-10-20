import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Check, X } from "lucide-react";
import { api } from "../lib/api";
import { fmtDateTime, fmtNumber, fmtSum, fullName, ORDER_STATUS, PAYMENT_METHOD_LABEL, TX_STATE } from "../lib/format";
import { EVENT_LABEL, eventAmountSum, eventResultText, PROVIDER_LABEL, reasonText } from "../lib/payments";
import type { PaymentTxDetail, PaymentTxEvent } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { AsyncView, Badge, Card, CardHeader, PageHeader } from "../components/ui";

const LANG_LABEL: Record<string, string> = { uz: "O'zbekcha", ru: "Ruscha", en: "Inglizcha" };

/** Kalit — qiymat ro'yxati (bo'sh qiymat "—") */
function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-gray-100 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 px-5 py-2.5">
          <dt className="shrink-0 text-gray-500">{k}</dt>
          <dd className="min-w-0 break-words text-right text-gray-900">{v === null || v === undefined || v === "" ? "—" : v}</dd>
        </div>
      ))}
    </dl>
  );
}

const mono = (v: string | null | undefined) => (v ? <span className="font-mono text-xs">{v}</span> : null);

/** Tizim so'rovi tafsilotlari (bo'sh maydonlar ko'rsatilmaydi) */
function eventDetails(provider: PaymentTxDetail["provider"], e: PaymentTxEvent): [string, string][] {
  const sum = eventAmountSum(provider, e.amount);
  const rows: [string, string | null | undefined][] = [
    ["Summa", sum === null ? null : provider === "payme" ? `${fmtSum(sum)} (${fmtNumber(Number(e.amount))} tiyin)` : fmtSum(sum)],
    ["Payme vaqti", e.payme_time ? fmtDateTime(new Date(e.payme_time).toISOString()) : null],
    ["Bekor qilish sababi", e.reason !== undefined ? String(e.reason) : null],
    ["Hisob (account)", e.account ? Object.entries(e.account).map(([k, v]) => `${k}=${v}`).join(", ") : null],
    ["Click xato kodi", e.click_error && e.click_error !== "0" ? `${e.click_error}${e.click_error_note ? ` — ${e.click_error_note}` : ""}` : null],
    ["Click to'lov hujjati", e.click_paydoc_id],
    ["Imzo vaqti (sign_time)", e.sign_time],
    ["Javob izohi", e.note],
  ];
  return rows.filter((r): r is [string, string] => !!r[1]);
}

export default function PaymentDetailPage() {
  const { id = "" } = useParams();
  const tx = useAsync(() => api.get<PaymentTxDetail>(`/orders/payments/${id}`).then((r) => r.data), [id]);

  return (
    <>
      <Link to="/payments" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" /> Onlayn to'lovlar
      </Link>
      <AsyncView state={tx}>
        {(t) => {
          const st = TX_STATE[t.state];
          const reason = reasonText(t);
          const o = t.order;
          const u = o.user;
          const events = t.meta?.events ?? [];
          const otherPaid = o.transactions.filter((x) => x.state === 2 && x.id !== t.id);
          return (
            <>
              <PageHeader
                title={`${PROVIDER_LABEL[t.provider]} to'lovi #${t.id}`}
                subtitle={`${o.product.title} · ${fullName(u)}`}
                action={<Badge tone={st?.tone ?? "gray"}>{st?.label ?? t.state}</Badge>}
              />

              {t.state === 2 && o.paymentMethod !== t.provider && (
                <div className="mb-6 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  Ortiqcha to'lov: buyurtma {PAYMENT_METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod} orqali allaqachon to'langan. Pulni mijozga qaytarish kerak bo'lishi mumkin.
                </div>
              )}
              {otherPaid.length > 0 && t.state === 2 && (
                <div className="mb-6 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  Shu buyurtma bo'yicha yana {otherPaid.length} ta to'langan tranzaksiya bor — pastdagi «Shu buyurtmadagi urinishlar» ga qarang.
                </div>
              )}

              <div className="grid gap-6 lg:grid-cols-3">
                <Card>
                  <CardHeader title="Tranzaksiya" />
                  <Rows
                    rows={[
                      ["Tizim", PROVIDER_LABEL[t.provider]],
                      ["Holat", <Badge key="s" tone={st?.tone ?? "gray"}>{st?.label ?? t.state}</Badge>],
                      ["Sabab / xato", reason],
                      ["Summa", <b key="a">{fmtSum(t.amount)}</b>],
                      ...(t.provider === "payme" ? ([["Summa (tiyin)", fmtNumber(t.amount * 100)]] as [string, ReactNode][]) : []),
                      ["Bizdagi ID", mono(t.id)],
                      [t.provider === "payme" ? "Payme tranzaksiya ID" : "Click tranzaksiya ID (click_trans_id)", mono(t.externalId)],
                      ...(t.provider === "click" ? ([["Click to'lov hujjati (click_paydoc_id)", mono(t.meta?.click_paydoc_id)]] as [string, ReactNode][]) : []),
                      ...(t.provider === "payme" ? ([["Payme'da yaratilgan", t.providerTime ? fmtDateTime(new Date(Number(t.providerTime)).toISOString()) : null]] as [string, ReactNode][]) : []),
                      ["Boshlangan", fmtDateTime(t.createdAt)],
                      ["To'langan", t.performedAt ? fmtDateTime(t.performedAt) : null],
                      [t.state === -2 ? "Pul qaytarilgan" : "Bekor qilingan", t.cancelledAt ? fmtDateTime(t.cancelledAt) : null],
                      ["Oxirgi o'zgarish", fmtDateTime(t.updatedAt)],
                    ]}
                  />
                </Card>

                <Card>
                  <CardHeader title="Buyurtma" action={<Link to={`/orders/${o.id}`} className="text-sm text-blue-600 hover:underline">Ochish</Link>} />
                  <Rows
                    rows={[
                      ["Buyurtma", <Link key="o" to={`/orders/${o.id}`} className="text-blue-600 hover:underline">#{o.id}</Link>],
                      ["Holat", <Badge key="s" tone={ORDER_STATUS[o.status]?.tone ?? "gray"}>{ORDER_STATUS[o.status]?.label ?? o.status}</Badge>],
                      ["Kurs", o.product.title],
                      ["Kurs kodi", mono(o.product.code)],
                      ["Kurs narxi", fmtSum(o.product.price)],
                      ["Buyurtma summasi", <b key="a">{fmtSum(o.amount)}</b>],
                      ["Chegirma", o.discount ? fmtSum(o.discount) : null],
                      ["To'lov usuli", PAYMENT_METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod],
                      ["Manba", o.source],
                      ["Ochilgan", fmtDateTime(o.createdAt)],
                      ["Muddat", fmtDateTime(o.expiresAt)],
                      ["To'langan", o.paidAt ? fmtDateTime(o.paidAt) : null],
                      ...(o.cancelledAt
                        ? ([
                            ["Bekor qilingan", fmtDateTime(o.cancelledAt)],
                            ["Bekor qilish sababi", o.cancelReason],
                          ] as [string, ReactNode][])
                        : []),
                    ]}
                  />
                </Card>

                <Card>
                  <CardHeader title="Mijoz" action={<Link to={`/telegram-users/${u.id}`} className="text-sm text-blue-600 hover:underline">Profil</Link>} />
                  <Rows
                    rows={[
                      ["Ism", <Link key="u" to={`/telegram-users/${u.id}`} className="text-blue-600 hover:underline">{fullName(u)}</Link>],
                      ["Telegram ID", mono(u.telegramId)],
                      ["Username", u.username ? <a key="n" href={`https://t.me/${u.username}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">@{u.username}</a> : null],
                      ["Telefon", u.phone],
                      ["Til", u.language ? (LANG_LABEL[u.language] ?? u.language) : null],
                      ["Botni bloklagan", u.isBlocked ? "Ha" : "Yo'q"],
                      ["Botga kirgan", fmtDateTime(u.createdAt)],
                    ]}
                  />
                </Card>
              </div>

              <Card className="mt-6">
                <CardHeader
                  title={`${PROVIDER_LABEL[t.provider]} so'rovlari tarixi`}
                  subtitle={events.length ? `${events.length} ta — ${PROVIDER_LABEL[t.provider]} serverimizga nima yuborgani va biz nima javob berganimiz` : undefined}
                />
                {events.length === 0 ? (
                  <p className="p-5 text-sm text-gray-500">Tarix yo'q — bu to'lov tarix yozila boshlashidan oldin yaratilgan.</p>
                ) : (
                  <ol className="divide-y divide-gray-100">
                    {events.map((e, i) => {
                      const ok = e.result === "ok";
                      const details = eventDetails(t.provider, e);
                      return (
                        <li key={`${e.at}-${i}`} className="flex gap-3 px-5 py-3 text-sm">
                          <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                            {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                              <span className="font-medium text-gray-900">{EVENT_LABEL[e.method] ?? e.method}</span>
                              <span className="text-xs tabular-nums text-gray-500">{fmtDateTime(e.at)}</span>
                            </div>
                            <div className={`text-xs ${ok ? "text-green-700" : "text-red-700"}`}>Javob: {eventResultText(t.provider, e)}</div>
                            {details.length > 0 && (
                              <dl className="mt-1 grid gap-x-4 text-xs text-gray-600 sm:grid-cols-2">
                                {details.map(([k, v]) => (
                                  <div key={k} className="flex gap-1">
                                    <dt className="text-gray-400">{k}:</dt>
                                    <dd className="break-all">{v}</dd>
                                  </div>
                                ))}
                              </dl>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Card>

              <Card className="mt-6">
                <CardHeader title="Shu buyurtmadagi urinishlar" subtitle={`${o.transactions.length} ta (Payme va Click)`} />
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-100 text-sm">
                    <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-5 py-2">#</th>
                        <th className="px-5 py-2">Tizim</th>
                        <th className="px-5 py-2">Tranzaksiya ID</th>
                        <th className="px-5 py-2">Holat</th>
                        <th className="px-5 py-2">Summa</th>
                        <th className="px-5 py-2">Boshlangan</th>
                        <th className="px-5 py-2">Yopilgan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {o.transactions.map((x) => {
                        const xs = TX_STATE[x.state];
                        const current = x.id === t.id;
                        return (
                          <tr key={x.id} className={current ? "bg-blue-50" : "hover:bg-gray-50"}>
                            <td className="px-5 py-2">
                              {current ? <span className="font-medium">#{x.id} (shu)</span> : <Link to={`/payments/${x.id}`} className="text-blue-600 hover:underline">#{x.id}</Link>}
                            </td>
                            <td className="px-5 py-2">{PROVIDER_LABEL[x.provider]}</td>
                            <td className="px-5 py-2 font-mono text-xs">{x.externalId}</td>
                            <td className="px-5 py-2">
                              <Badge tone={xs?.tone ?? "gray"}>{xs?.label ?? x.state}</Badge>
                              {reasonText(x) && <div className="mt-0.5 text-xs text-gray-500">{reasonText(x)}</div>}
                            </td>
                            <td className="whitespace-nowrap px-5 py-2 tabular-nums">{fmtSum(x.amount)}</td>
                            <td className="whitespace-nowrap px-5 py-2 text-xs text-gray-600">{fmtDateTime(x.createdAt)}</td>
                            <td className="whitespace-nowrap px-5 py-2 text-xs text-gray-600">{fmtDateTime(x.performedAt ?? x.cancelledAt)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          );
        }}
      </AsyncView>
    </>
  );
}
