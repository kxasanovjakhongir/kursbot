import { useState } from "react";
import { Link } from "react-router-dom";
import { Ban, Megaphone, MessageSquare, RefreshCw, Receipt, UserCheck, UserPlus, Users, Wallet, type LucideIcon } from "lucide-react";
import { api } from "../lib/api";
import { fmtNumber, fmtSum, timeAgo } from "../lib/format";
import type { BotStatus, DashboardStats } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { AsyncView, Badge, Button, Card, PageHeader } from "../components/ui";

function Stat({ label, value, icon: Icon, tone = "blue", hint }: { label: string; value: string; icon: LucideIcon; tone?: "blue" | "green" | "red" | "amber"; hint?: string }) {
  const tones = { blue: "bg-blue-50 text-blue-600", green: "bg-green-50 text-green-600", red: "bg-red-50 text-red-600", amber: "bg-amber-50 text-amber-600" };
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-gray-500">{label}</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums text-gray-900">{value}</p>
          {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

function BotStatusCard() {
  const [tick, setTick] = useState(0);
  const status = useAsync(() => api.get<BotStatus>("/bot/status").then((r) => r.data), [tick]);
  const s = status.data;
  const online = !!s?.online && !!s.reachable;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div>
            <p className="font-semibold text-gray-900">{s ? (online ? "🟢 Bot Online" : "🔴 Bot Offline") : "Tekshirilmoqda…"}</p>
            {s && <p className="text-xs text-gray-500">Oxirgi tekshiruv: {timeAgo(s.checkedAt)}</p>}
          </div>
          {s?.maintenance && <Badge tone="yellow">Maintenance</Badge>}
        </div>
        <Button variant="secondary" size="sm" onClick={() => setTick((t) => t + 1)} loading={status.loading}>
          <RefreshCw className="h-3.5 w-3.5" /> Statusni yangilash
        </Button>
      </div>
      {status.error && <p className="mt-3 text-sm text-red-600">{status.error}</p>}
      {s && (
        <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-gray-100 pt-4 text-sm sm:grid-cols-5">
          <div>
            <dt className="text-gray-500">Bot nomi</dt>
            <dd className="mt-0.5 font-medium text-gray-900">{s.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Username</dt>
            <dd className="mt-0.5 font-medium text-gray-900">{s.username ? `@${s.username}` : "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Bot ID</dt>
            <dd className="mt-0.5 font-mono text-gray-900">{s.id ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Rejim</dt>
            <dd className="mt-0.5 font-medium text-gray-900">{s.mode}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Foydalanuvchilar</dt>
            <dd className="mt-0.5 font-medium tabular-nums text-gray-900">{fmtNumber(s.totalUsers)}</dd>
          </div>
        </dl>
      )}
      {s && !s.reachable && s.error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{s.error}</p>}
    </Card>
  );
}

export default function DashboardPage() {
  const stats = useAsync(() => api.get<DashboardStats>("/dashboard/stats").then((r) => r.data), []);

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Bot va savdo ko'rsatkichlari (Toshkent vaqti bo'yicha)" />
      <div className="space-y-6">
        <BotStatusCard />
        <AsyncView state={stats}>
          {(s) => (
            <>
              <section>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Telegram foydalanuvchilar</h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Stat label="Jami foydalanuvchilar" value={fmtNumber(s.users.total)} icon={Users} />
                  <Stat label="Faol" value={fmtNumber(s.users.active)} icon={UserCheck} tone="green" hint={`30 kunda faol: ${fmtNumber(s.users.active30d)}`} />
                  <Stat label="Botni bloklagan" value={fmtNumber(s.users.blocked)} icon={Ban} tone="red" hint={`Admin cheklagan: ${fmtNumber(s.users.banned)}`} />
                  <Stat label="Bugun yangi" value={fmtNumber(s.users.newToday)} icon={UserPlus} tone="amber" />
                  <Stat label="Shu hafta yangi" value={fmtNumber(s.users.newWeek)} icon={UserPlus} hint="Oxirgi 7 kun" />
                  <Stat label="Shu oy yangi" value={fmtNumber(s.users.newMonth)} icon={UserPlus} hint="Oxirgi 30 kun" />
                  <Stat label="Bugungi xabarlar" value={fmtNumber(s.messagesToday)} icon={MessageSquare} />
                  <Stat label="Yuborilgan broadcastlar" value={fmtNumber(s.broadcastsSent)} icon={Megaphone} />
                </div>
              </section>
              <section>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Savdo</h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Link to="/receipts">
                    <Stat label="Tekshiruvdagi cheklar" value={fmtNumber(s.sales.pendingReceipts)} icon={Receipt} tone={s.sales.pendingReceipts > 0 ? "amber" : "green"} />
                  </Link>
                  <Stat label="Bugungi buyurtmalar" value={fmtNumber(s.sales.ordersToday)} icon={Receipt} />
                  <Stat label="Bugungi tushum" value={fmtSum(s.sales.revenueToday)} icon={Wallet} tone="green" />
                  <Stat label="30 kunlik tushum" value={fmtSum(s.sales.revenueMonth)} icon={Wallet} tone="green" />
                </div>
              </section>
            </>
          )}
        </AsyncView>
      </div>
    </>
  );
}
