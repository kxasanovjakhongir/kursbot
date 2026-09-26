import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api } from "../lib/api";
import { AUDIENCE_LABEL, fmtDateTime, fmtNumber } from "../lib/format";
import type { BroadcastDetail } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { BroadcastStatusBadge, deliveryPct, ProgressBar } from "../components/BroadcastStats";
import { AsyncView, Badge, Card, CardHeader, PageHeader, Table, Td, Th } from "../components/ui";

const TYPE_LABEL = { text: "Matn", photo: "Rasm", video: "Video", document: "Hujjat", other: "Boshqa" } as const;

export default function BroadcastDetailPage() {
  const { id = "" } = useParams();
  const state = useAsync(() => api.get<BroadcastDetail>(`/broadcast/${id}`).then((r) => r.data), [id]);
  const running = state.data && (state.data.broadcast.status === "pending" || state.data.broadcast.status === "sending");

  // Yuborilayotganda jarayon har 2 soniyada yangilanadi
  useEffect(() => {
    if (!running) return;
    const t = setInterval(state.reload, 2000);
    return () => clearInterval(t);
  }, [running, state.reload]);

  return (
    <>
      <Link to="/broadcast/history" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" /> Broadcast tarixi
      </Link>
      <AsyncView state={state}>
        {({ broadcast: b, pending, failures }) => (
          <>
            <PageHeader title={`Broadcast #${b.id}`} action={<BroadcastStatusBadge status={b.status} />} />
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader title="Yetkazish" subtitle={running ? `Navbatda: ${fmtNumber(pending)}` : undefined} />
                <div className="space-y-5 p-5">
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    {[
                      ["Jami", b.total],
                      ["Yuborildi", b.sent],
                      ["Xato", b.failed],
                      ["Yetkazish", `${deliveryPct(b)}%`],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <p className="text-xs text-gray-500">{k}</p>
                        <p className="mt-1 text-xl font-semibold tabular-nums text-gray-900">{typeof v === "number" ? fmtNumber(v) : v}</p>
                      </div>
                    ))}
                  </div>
                  <ProgressBar b={b} />
                </div>
              </Card>
              <Card>
                <CardHeader title="Ma'lumot" />
                <dl className="space-y-2.5 p-5 text-sm">
                  {[
                    ["Turi", TYPE_LABEL[b.messageType]],
                    ["Auditoriya", b.product ? `${AUDIENCE_LABEL[b.audience]}: ${b.product.title}` : AUDIENCE_LABEL[b.audience]],
                    ["Fayl", b.fileName ?? "—"],
                    ["Yaratgan", b.createdBy?.name ?? "—"],
                    ["Yaratilgan", fmtDateTime(b.createdAt)],
                    ["Tugagan", fmtDateTime(b.finishedAt)],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4">
                      <dt className="text-gray-500">{k}</dt>
                      <dd className="truncate text-right text-gray-900">{v}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            </div>
            {b.text && (
              <Card className="mt-6">
                <CardHeader title="Xabar" />
                <p className="whitespace-pre-wrap break-words p-5 text-sm text-gray-800">{b.text}</p>
              </Card>
            )}
            {failures.length > 0 && (
              <Card className="mt-6">
                <CardHeader title="Yetkazilmaganlar" subtitle="Birinchi 50 tasi" />
                <Table
                  head={
                    <tr>
                      <Th>Foydalanuvchi</Th>
                      <Th>Holat</Th>
                      <Th>Sabab</Th>
                    </tr>
                  }
                >
                  {failures.map((f) => (
                    <tr key={f.id}>
                      <Td>
                        <Link to={`/telegram-users/${f.user.id}`} className="text-blue-600 hover:underline">
                          {f.user.firstName ?? f.user.telegramId}
                        </Link>
                      </Td>
                      <Td>{f.status === "failed" ? <Badge tone="red">Xato</Badge> : <Badge tone="gray">O'tkazildi</Badge>}</Td>
                      <Td className="text-gray-600">{f.error ?? "—"}</Td>
                    </tr>
                  ))}
                </Table>
              </Card>
            )}
          </>
        )}
      </AsyncView>
    </>
  );
}
