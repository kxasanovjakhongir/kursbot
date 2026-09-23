import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, Search } from "lucide-react";
import { api } from "../lib/api";
import { fmtDate, fullName, timeAgo } from "../lib/format";
import type { Paged, TelegramUser } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { useDebounced } from "../hooks/useDebounced";
import { AsyncView, Badge, Card, EmptyState, Input, PageHeader, Pagination, Select, Table, Td, Th } from "../components/ui";

type Status = "all" | "active" | "blocked";

export default function TelegramUsersPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);

  const users = useAsync(
    () => api.get<Paged<TelegramUser>>("/telegram-users", { params: { q: dq || undefined, status, page } }).then((r) => r.data),
    [dq, status, page],
  );

  return (
    <>
      <PageHeader title="Telegram foydalanuvchilar" subtitle="Botdan foydalangan barcha foydalanuvchilar" />
      <Card>
        <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row">
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
          <Select
            className="sm:w-44"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as Status);
              setPage(1);
            }}
          >
            <option value="all">Barchasi</option>
            <option value="active">Faol</option>
            <option value="blocked">Bloklagan</option>
          </Select>
        </div>
        <AsyncView state={users}>
          {(d) =>
            d.items.length === 0 ? (
              <EmptyState title="Foydalanuvchilar topilmadi" hint={q ? "Qidiruv so'zini o'zgartirib ko'ring" : undefined} />
            ) : (
              <>
                <Table
                  head={
                    <tr>
                      <Th>ID</Th>
                      <Th>Telegram ID</Th>
                      <Th>Username</Th>
                      <Th>Ism</Th>
                      <Th className="hidden lg:table-cell">Til</Th>
                      <Th>Holat</Th>
                      <Th className="hidden md:table-cell">Qo'shilgan</Th>
                      <Th className="hidden md:table-cell">Oxirgi faollik</Th>
                      <Th />
                    </tr>
                  }
                >
                  {d.items.map((u) => (
                    <tr key={u.id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/telegram-users/${u.id}`)}>
                      <Td className="text-gray-500">{u.id}</Td>
                      <Td className="font-mono text-xs">{u.telegramId}</Td>
                      <Td>{u.username ? `@${u.username}` : <span className="text-gray-400">—</span>}</Td>
                      <Td className="font-medium text-gray-900">{fullName(u)}</Td>
                      <Td className="hidden uppercase text-gray-500 lg:table-cell">{u.languageCode ?? "—"}</Td>
                      <Td>{u.isBlocked ? <Badge tone="red">Bloklagan</Badge> : <Badge tone="green">Faol</Badge>}</Td>
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
