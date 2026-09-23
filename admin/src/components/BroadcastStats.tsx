import { fmtNumber } from "../lib/format";
import type { Broadcast } from "../lib/types";
import { Badge } from "./ui";

export const deliveryPct = (b: Broadcast) => (b.total ? Math.round((b.sent / b.total) * 100) : 0);

export function BroadcastStatusBadge({ status }: { status: Broadcast["status"] }) {
  const map = {
    pending: { tone: "gray", label: "Navbatda" },
    sending: { tone: "blue", label: "Yuborilmoqda" },
    completed: { tone: "green", label: "Yakunlandi" },
    failed: { tone: "red", label: "Xato" },
  } as const;
  return <Badge tone={map[status].tone}>{map[status].label}</Badge>;
}

/** Yuborish jarayoni: yuborildi / xato / o'tkazildi ulushlari */
export function ProgressBar({ b }: { b: Broadcast }) {
  const pct = (n: number) => (b.total ? (n / b.total) * 100 : 0);
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-gray-100">
        <div className="bg-green-500 transition-all" style={{ width: `${pct(b.sent)}%` }} />
        <div className="bg-red-500 transition-all" style={{ width: `${pct(b.failed)}%` }} />
        <div className="bg-gray-400 transition-all" style={{ width: `${pct(b.skipped)}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-green-500" />
          Yuborildi {fmtNumber(b.sent)}
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />
          Xato {fmtNumber(b.failed)}
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-gray-400" />
          O'tkazildi {fmtNumber(b.skipped)}
        </span>
      </div>
    </div>
  );
}
