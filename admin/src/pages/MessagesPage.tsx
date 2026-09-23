import { useState } from "react";
import { Search } from "lucide-react";
import { api } from "../lib/api";
import type { ChatMessage, Direction, Paged } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { useDebounced } from "../hooks/useDebounced";
import { MessageTable } from "../components/MessageTable";
import { AsyncView, Card, EmptyState, Input, PageHeader, Pagination, Select } from "../components/ui";

export default function MessagesPage() {
  const [direction, setDirection] = useState<"all" | Direction>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const messages = useAsync(
    () => api.get<Paged<ChatMessage>>("/messages", { params: { direction, q: dq || undefined, page } }).then((r) => r.data),
    [direction, dq, page],
  );

  return (
    <>
      <PageHeader title="Xabarlar" subtitle="Bot orqali o'tgan barcha xabarlar, eng yangisi birinchi" />
      <Card>
        <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              className="pl-9"
              placeholder="Xabar matni bo'yicha qidirish"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select
            className="sm:w-44"
            value={direction}
            onChange={(e) => {
              setDirection(e.target.value as "all" | Direction);
              setPage(1);
            }}
          >
            <option value="all">Barchasi</option>
            <option value="incoming">Kiruvchi</option>
            <option value="outgoing">Chiquvchi</option>
          </Select>
        </div>
        <AsyncView state={messages}>
          {(d) =>
            d.items.length === 0 ? (
              <EmptyState title="Xabarlar topilmadi" />
            ) : (
              <>
                <MessageTable items={d.items} showUser />
                <Pagination page={d.page} pages={d.pages} total={d.total} onPage={setPage} />
              </>
            )
          }
        </AsyncView>
      </Card>
    </>
  );
}
