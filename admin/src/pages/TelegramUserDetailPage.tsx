import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api } from "../lib/api";
import { fmtDateTime, fmtSum, fullName, ORDER_STATUS } from "../lib/format";
import type { ChatMessage, Paged, TelegramUserDetail } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { MessageTable } from "../components/MessageTable";
import { AsyncView, Badge, Card, CardHeader, EmptyState, PageHeader, Pagination, Table, Td, Th } from "../components/ui";

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium text-gray-900">{children}</dd>
    </div>
  );
}

export default function TelegramUserDetailPage() {
  const { id = "" } = useParams();
  const [page, setPage] = useState(1);
  const user = useAsync(() => api.get<TelegramUserDetail>(`/telegram-users/${id}`).then((r) => r.data), [id]);
  const messages = useAsync(
    () => api.get<Paged<ChatMessage>>(`/telegram-users/${id}/messages`, { params: { page } }).then((r) => r.data),
    [id, page],
  );

  return (
    <>
      <Link to="/telegram-users" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" /> Foydalanuvchilar
      </Link>
      <AsyncView state={user}>
        {(u) => (
          <>
            <PageHeader
              title={fullName(u)}
              subtitle={u.username ? `@${u.username}` : undefined}
              action={u.isBlocked ? <Badge tone="red">Bloklagan</Badge> : <Badge tone="green">Faol</Badge>}
            />
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader title="Ma'lumotlar" />
                <dl className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-3">
                  <Info label="Telegram ID">
                    <span className="font-mono">{u.telegramId}</span>
                  </Info>
                  <Info label="Username">{u.username ? `@${u.username}` : "—"}</Info>
                  <Info label="Ism">{u.firstName ?? "—"}</Info>
                  <Info label="Familiya">{u.lastName ?? "—"}</Info>
                  <Info label="Til">{u.languageCode?.toUpperCase() ?? "—"}</Info>
                  <Info label="Telefon">
                    {u.phone ?? "—"} {u.isForeign && <Badge tone="yellow">xorijiy</Badge>}
                  </Info>
                  <Info label="Qo'shilgan">{fmtDateTime(u.createdAt)}</Info>
                  <Info label="Oxirgi faollik">{fmtDateTime(u.lastSeenAt)}</Info>
                  <Info label="Manba (birinchi)">{u.firstSource ?? "—"}</Info>
                </dl>
              </Card>
              <Card>
                <CardHeader title="Xaridlar" />
                <div className="p-5">
                  {u.grants.length === 0 ? (
                    <p className="text-sm text-gray-500">Xaridlar yo'q</p>
                  ) : (
                    <ul className="space-y-2 text-sm">
                      {u.grants.map((g) => (
                        <li key={g.id} className="flex items-center justify-between gap-2">
                          <span>{g.product.title}</span>
                          {g.joinedAt ? <Badge tone="green">Kanalda</Badge> : <Badge tone="yellow">Kirmagan</Badge>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
            </div>

            {u.orders.length > 0 && (
              <Card className="mt-6">
                <CardHeader title="Buyurtmalar" />
                <Table
                  head={
                    <tr>
                      <Th>#</Th>
                      <Th>Mahsulot</Th>
                      <Th>Summa</Th>
                      <Th>Holat</Th>
                      <Th>Sana</Th>
                    </tr>
                  }
                >
                  {u.orders.map((o) => (
                    <tr key={o.id} className="hover:bg-gray-50">
                      <Td>
                        <Link to={`/orders/${o.id}`} className="text-blue-600 hover:underline">
                          #{o.id}
                        </Link>
                      </Td>
                      <Td>{o.product.title}</Td>
                      <Td className="whitespace-nowrap tabular-nums">{fmtSum(o.amount)}</Td>
                      <Td>
                        <Badge tone={ORDER_STATUS[o.status]?.tone ?? "gray"}>{ORDER_STATUS[o.status]?.label ?? o.status}</Badge>
                      </Td>
                      <Td className="whitespace-nowrap text-gray-500">{fmtDateTime(o.createdAt)}</Td>
                    </tr>
                  ))}
                </Table>
              </Card>
            )}
          </>
        )}
      </AsyncView>

      <Card className="mt-6">
        <CardHeader title="Xabarlar tarixi" subtitle="Foydalanuvchi va bot o'rtasidagi yozishma" />
        <AsyncView state={messages}>
          {(d) =>
            d.items.length === 0 ? (
              <EmptyState title="Xabarlar yo'q" />
            ) : (
              <>
                <MessageTable items={d.items} />
                <Pagination page={d.page} pages={d.pages} total={d.total} onPage={setPage} />
              </>
            )
          }
        </AsyncView>
      </Card>
    </>
  );
}
