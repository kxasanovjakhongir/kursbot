import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { fmtNumber, fmtSum } from "../lib/format";
import type { Analytics, AnalyticsSegment } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { BarList, Funnel, LineChart } from "../components/charts";
import { AsyncView, Badge, Card, CardHeader, Input, PageHeader, Table, Td, Th } from "../components/ui";

type Preset = "today" | "yesterday" | "7d" | "30d" | "month" | "custom";

const PRESETS: { value: Preset; label: string }[] = [
  { value: "today", label: "Bugun" },
  { value: "yesterday", label: "Kecha" },
  { value: "7d", label: "7 kun" },
  { value: "30d", label: "30 kun" },
  { value: "month", label: "Shu oy" },
  { value: "custom", label: "Oraliq" },
];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dateInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Davr [from, to) — admin brauzerining mahalliy kunlari bo'yicha */
function rangeOf(preset: Preset, custom: { from: string; to: string }): { from: Date; to: Date } | null {
  const today = startOfDay(new Date());
  switch (preset) {
    case "today":
      return { from: today, to: addDays(today, 1) };
    case "yesterday":
      return { from: addDays(today, -1), to: today };
    case "7d":
      return { from: addDays(today, -6), to: addDays(today, 1) };
    case "30d":
      return { from: addDays(today, -29), to: addDays(today, 1) };
    case "month":
      return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: addDays(today, 1) };
    case "custom": {
      if (!custom.from || !custom.to) return null;
      const from = new Date(`${custom.from}T00:00:00`);
      const to = addDays(new Date(`${custom.to}T00:00:00`), 1);
      return to > from ? { from, to } : null;
    }
  }
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
    </Card>
  );
}

function SegmentTable({ rows, withCampaign }: { rows: AnalyticsSegment[]; withCampaign: boolean }) {
  if (rows.length === 0) return <p className="p-6 text-center text-sm text-gray-400">Bu davrda ma'lumot yo'q</p>;
  return (
    <Table
      head={
        <tr>
          {withCampaign && <Th>Kurs</Th>}
          <Th>Manba</Th>
          {withCampaign && <Th>Kampaniya</Th>}
          <Th className="text-right" title="Unique bosishlar (tracking link)">Bosish</Th>
          <Th className="text-right" title="Link orqali kirgan unique foydalanuvchilar">Kirgan</Th>
          <Th className="text-right" title="Telefon ulashgan">Ro'yxat</Th>
          <Th className="text-right" title="Buyurtma bergan foydalanuvchilar">Lead</Th>
          <Th className="text-right">Xarid</Th>
          <Th className="text-right">Daromad</Th>
          <Th className="text-right" title="Xaridlar / kirganlar">Konv.</Th>
        </tr>
      }
    >
      {rows.map((r) => (
        <tr key={`${r.course}|${r.source}|${r.campaign}`} className="hover:bg-gray-50">
          {withCampaign && <Td className="text-gray-900">{r.course ?? "—"}</Td>}
          <Td>{r.source === "organic" ? <Badge tone="gray">linksiz (organik)</Badge> : <Badge tone="blue">{r.source}</Badge>}</Td>
          {withCampaign && <Td className="text-gray-600">{r.campaign ?? "—"}</Td>}
          <Td className="text-right tabular-nums">{fmtNumber(r.clicks)}</Td>
          <Td className="text-right tabular-nums">{fmtNumber(r.users)}</Td>
          <Td className="text-right tabular-nums">{fmtNumber(r.registered)}</Td>
          <Td className="text-right tabular-nums">{fmtNumber(r.leads)}</Td>
          <Td className="text-right tabular-nums">{fmtNumber(r.purchases)}</Td>
          <Td className="whitespace-nowrap text-right tabular-nums font-medium text-gray-900">{fmtSum(r.revenue)}</Td>
          <Td className="text-right tabular-nums">{r.source === "organic" ? "—" : `${r.conversion.toFixed(1)}%`}</Td>
        </tr>
      ))}
    </Table>
  );
}

/** Marketing analitikasi: KPI, funnel, grafiklar, kurslar, manbalar va kampaniyalar */
export default function AnalyticsPage() {
  const [preset, setPreset] = useState<Preset>("30d");
  const [custom, setCustom] = useState({ from: dateInput(addDays(new Date(), -13)), to: dateInput(new Date()) });
  const range = useMemo(() => rangeOf(preset, custom), [preset, custom]);

  const data = useAsync(
    () =>
      range
        ? api.get<Analytics>("/analytics", { params: { from: range.from.toISOString(), to: range.to.toISOString() } }).then((r) => r.data)
        : Promise.reject(new Error("Sanalarni to'g'ri tanlang")),
    [range?.from.getTime(), range?.to.getTime()],
  );

  return (
    <>
      <PageHeader
        title="Analitika"
        subtitle="Qaysi kurs, manba va kampaniya qancha foydalanuvchi, xarid va daromad olib keldi"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPreset(p.value)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${preset === p.value ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {preset === "custom" && (
              <div className="flex items-center gap-1">
                <div className="w-40">
                  <Input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="Dan" />
                </div>
                <span className="text-gray-400">—</span>
                <div className="w-40">
                  <Input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="Gacha" />
                </div>
              </div>
            )}
          </div>
        }
      />

      <AsyncView state={data}>
        {(a) => (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              <Kpi label="Foydalanuvchilar" value={fmtNumber(a.totals.users)} hint={`davrda yangi: ${fmtNumber(a.totals.newUsers)}`} />
              <Kpi label="Leadlar" value={fmtNumber(a.totals.leads)} hint="buyurtma berganlar" />
              <Kpi label="Xaridlar" value={fmtNumber(a.totals.purchases)} hint={`xaridorlar: ${fmtNumber(a.totals.buyers)}`} />
              <Kpi label="Daromad" value={fmtSum(a.totals.revenue)} />
              <Kpi label="Konversiya" value={`${a.totals.conversion.toFixed(1)}%`} hint="botga kirganlardan sotib olganlar" />
            </div>

            <Card>
              <CardHeader
                title="Funnel"
                subtitle="Davrda botga kirganlar ketma-ket: har bir bosqich — oldingisidan o'tganlar ichidan. O'ngda — o'tish foizi"
              />
              <div className="p-5">
                <Funnel
                  steps={[
                    { label: "Link bosildi", value: a.funnel.clicks, hint: "Tracking link (/l/…) orqali unique bosishlar" },
                    { label: "Botga kirdi", value: a.funnel.started, hint: "/start bosgan" },
                    { label: "Ro'yxatdan o'tdi", value: a.funnel.registered, hint: "Telefon raqamini ulashdi" },
                    { label: "Kursni ko'rdi", value: a.funnel.viewed },
                    { label: "Buyurtma berdi", value: a.funnel.ordered },
                    { label: "Sotib oldi", value: a.funnel.purchased },
                  ]}
                />
              </div>
            </Card>

            <div className="grid gap-6 lg:grid-cols-3">
              <Card>
                <CardHeader title="Foydalanuvchilar o'sishi" subtitle="Kunlik yangi foydalanuvchilar" />
                <div className="p-4">
                  <LineChart data={a.series.map((s) => ({ label: s.day, value: s.newUsers }))} format={fmtNumber} />
                </div>
              </Card>
              <Card>
                <CardHeader title="Xaridlar" subtitle="Kunlik tasdiqlangan to'lovlar" />
                <div className="p-4">
                  <LineChart data={a.series.map((s) => ({ label: s.day, value: s.purchases }))} format={fmtNumber} color="#16a34a" />
                </div>
              </Card>
              <Card>
                <CardHeader title="Daromad" subtitle="Kunlik tushum" />
                <div className="p-4">
                  <LineChart data={a.series.map((s) => ({ label: s.day, value: s.revenue }))} format={fmtSum} color="#9333ea" />
                </div>
              </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader title="Kurslar ommabopligi" subtitle="Qiziqqanlar: link orqali kirgan yoki kursni ko'rgan unique foydalanuvchilar" />
                <div className="p-5">
                  <BarList
                    items={a.courses
                      .filter((c) => c.interested || c.purchases)
                      .sort((x, y) => y.interested - x.interested)
                      .map((c) => ({ label: c.title, value: c.interested, hint: `konv. ${c.conversion.toFixed(1)}%` }))}
                    format={fmtNumber}
                  />
                </div>
              </Card>
              <Card>
                <CardHeader title="Manbalar samaradorligi" subtitle="Daromad bo'yicha" />
                <div className="p-5">
                  <BarList
                    items={a.sources.map((s) => ({ label: s.source === "organic" ? "linksiz (organik)" : s.source, value: s.revenue, hint: `${fmtNumber(s.purchases)} xarid` }))}
                    format={fmtSum}
                  />
                </div>
              </Card>
            </div>

            <Card>
              <CardHeader title="Kurslar bo'yicha" />
              <Table
                head={
                  <tr>
                    <Th>Kurs</Th>
                    <Th className="text-right" title="Link orqali kirgan yoki kursni ko'rgan unique foydalanuvchilar">Qiziqqan</Th>
                    <Th className="text-right" title="Shu kurs linki yoki deep link bilan botga kirganlar">Link orqali</Th>
                    <Th className="text-right">Ko'rgan</Th>
                    <Th className="text-right" title="Buyurtma berganlar">Lead</Th>
                    <Th className="text-right">Xarid</Th>
                    <Th className="text-right">Daromad</Th>
                    <Th className="text-right" title="Xaridorlar / qiziqqanlar">Konv.</Th>
                  </tr>
                }
              >
                {a.courses.map((c) => (
                  <tr key={c.productId} className="hover:bg-gray-50">
                    <Td className="font-medium text-gray-900">{c.title}</Td>
                    <Td className="text-right tabular-nums font-medium text-gray-900">{fmtNumber(c.interested)}</Td>
                    <Td className="text-right tabular-nums">{fmtNumber(c.started)}</Td>
                    <Td className="text-right tabular-nums">{fmtNumber(c.viewed)}</Td>
                    <Td className="text-right tabular-nums">{fmtNumber(c.leads)}</Td>
                    <Td className="text-right tabular-nums">{fmtNumber(c.purchases)}</Td>
                    <Td className="whitespace-nowrap text-right tabular-nums font-medium text-gray-900">{fmtSum(c.revenue)}</Td>
                    <Td className="text-right tabular-nums">{c.conversion.toFixed(1)}%</Td>
                  </tr>
                ))}
              </Table>
            </Card>

            <Card>
              <CardHeader title="Manbalar" subtitle="Kampaniya linklari manbasi bo'yicha jamlanma" />
              <SegmentTable rows={a.sources} withCampaign={false} />
            </Card>

            <Card>
              <CardHeader title="Kampaniyalar" subtitle="Kurs × manba × kampaniya" />
              <SegmentTable rows={a.campaigns} withCampaign />
            </Card>
          </div>
        )}
      </AsyncView>
    </>
  );
}
