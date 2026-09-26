import { useId } from "react";

/**
 * Yengil grafiklar (SVG + Tailwind) — chart kutubxonasisiz. Katta davrlar uchun ham yetarli:
 * nuqtalar soni kunlar soniga teng (≤ 366).
 */

const W = 640;
const H = 180;
const PAD = { top: 12, right: 8, bottom: 6, left: 8 };

export interface Point {
  label: string;
  value: number;
}

export function LineChart({ data, format = String, color = "#2563eb" }: { data: Point[]; format?: (n: number) => string; color?: string }) {
  const gradientId = useId();
  if (data.length === 0) return <p className="py-10 text-center text-sm text-gray-400">Ma'lumot yo'q</p>;
  const max = Math.max(1, ...data.map((d) => d.value));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const line = data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  const area = `${x(0)},${PAD.top + innerH} ${line} ${x(data.length - 1)},${PAD.top + innerH}`;
  // X o'qida 5 tagacha belgi — ko'p kunli davrda yozuvlar ustma-ust tushmaydi
  const step = Math.max(1, Math.ceil(data.length / 5));
  const total = data.reduce((a, d) => a + d.value, 0);

  return (
    <div>
      <div className="mb-1 text-right text-xs text-gray-500">
        jami: <span className="font-semibold text-gray-800">{format(total)}</span> · eng ko'p: {format(max)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label={`Jami ${format(total)}`}>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={PAD.left} x2={W - PAD.right} y1={y(max * f)} y2={y(max * f)} stroke="#e5e7eb" strokeDasharray="3 3" />
        ))}
        <polygon points={area} fill={`url(#${gradientId})`} />
        <polyline points={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
        {data.map((d, i) => (
          <circle key={d.label} cx={x(i)} cy={y(d.value)} r={data.length > 60 ? 1.5 : 3} fill={color}>
            <title>{`${d.label}: ${format(d.value)}`}</title>
          </circle>
        ))}
      </svg>
      {/* O'q yozuvlari HTML da — SVG bilan birga kichraymaydi, har doim o'qiladi */}
      <div className="relative mt-1 h-4 text-[11px] text-gray-500">
        {data.map((d, i) =>
          i % step === 0 || i === data.length - 1 ? (
            <span
              key={d.label}
              className="absolute -translate-x-1/2 whitespace-nowrap first:translate-x-0 last:-translate-x-full"
              style={{ left: `${(x(i) / W) * 100}%` }}
            >
              {`${d.label.slice(8, 10)}.${d.label.slice(5, 7)}`}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

export function BarList({ items, format = String }: { items: { label: string; value: number; hint?: string }[]; format?: (n: number) => string }) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-gray-400">Ma'lumot yo'q</p>;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.label}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate text-gray-700">{i.label}</span>
            <span className="shrink-0 font-medium tabular-nums text-gray-900">
              {format(i.value)}
              {i.hint && <span className="ml-1 text-xs font-normal text-gray-400">{i.hint}</span>}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-blue-500" style={{ width: `${(i.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Funnel: har bir bosqich birinchisiga nisbatan kenglikda; oldingi bosqichdan o'tish foizi */
export function Funnel({ steps }: { steps: { label: string; value: number; hint?: string }[] }) {
  const top = Math.max(1, ...steps.map((s) => s.value));
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        const rate = prev ? Math.round((s.value / prev) * 1000) / 10 : null;
        return (
          <li key={s.label} className="flex items-center gap-3">
            <div className="w-36 shrink-0 text-sm text-gray-600" title={s.hint}>
              {s.label}
            </div>
            <div className="h-7 flex-1 overflow-hidden rounded-lg bg-gray-100">
              {s.value > 0 && <div className="h-full rounded-lg bg-gradient-to-r from-blue-500 to-indigo-500" style={{ width: `${Math.max(1.5, (s.value / top) * 100)}%` }} />}
            </div>
            <div className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums text-gray-900">{s.value.toLocaleString("ru-RU")}</div>
            <div className="w-14 shrink-0 text-right text-xs tabular-nums text-gray-500" title="Oldingi bosqichdan o'tganlar">
              {rate === null ? (i > 0 ? "—" : "") : `${rate}%`}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
