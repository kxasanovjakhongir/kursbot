import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { api } from "../lib/api";
import { fmtDateTime, fmtNumber } from "../lib/format";
import type { Broadcast, Paged } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { BroadcastStatusBadge, deliveryPct } from "../components/BroadcastStats";
import { AsyncView, Button, Card, EmptyState, PageHeader, Pagination, Table, Td, Th } from "../components/ui";

export default function BroadcastHistoryPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const list = useAsync(() => api.get<Paged<Broadcast>>("/broadcast", { params: { page } }).then((r) => r.data), [page]);

  const newButton = (
    <Link to="/broadcast">
      <Button>
        <Plus className="h-4 w-4" /> Yangi broadcast
      </Button>
    </Link>
  );

  return (
    <>
      <PageHeader title="Broadcast tarixi" action={newButton} />
      <Card>
        <AsyncView state={list}>
          {(d) =>
            d.items.length === 0 ? (
              <EmptyState title="Hali broadcast yuborilmagan" action={newButton} />
            ) : (
              <>
                <Table
                  head={
                    <tr>
                      <Th>ID</Th>
                      <Th>Xabar</Th>
                      <Th>Qabul qiluvchilar</Th>
                      <Th>Yuborildi</Th>
                      <Th>Xato</Th>
                      <Th>Yetkazish</Th>
                      <Th>Holat</Th>
                      <Th className="hidden md:table-cell">Yaratgan</Th>
                      <Th className="hidden md:table-cell">Sana</Th>
                    </tr>
                  }
                >
                  {d.items.map((b) => (
                    <tr key={b.id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/broadcast/${b.id}`)}>
                      <Td className="font-medium text-blue-600">#{b.id}</Td>
                      <Td className="max-w-xs truncate text-gray-800">{b.text ?? b.fileName ?? `[${b.messageType}]`}</Td>
                      <Td className="tabular-nums">{fmtNumber(b.total)}</Td>
                      <Td className="tabular-nums text-green-700">{fmtNumber(b.sent)}</Td>
                      <Td className="tabular-nums text-red-600">{fmtNumber(b.failed)}</Td>
                      <Td className="tabular-nums">{deliveryPct(b)}%</Td>
                      <Td>
                        <BroadcastStatusBadge status={b.status} />
                      </Td>
                      <Td className="hidden md:table-cell">{b.createdBy?.name ?? "—"}</Td>
                      <Td className="hidden whitespace-nowrap text-gray-500 md:table-cell">{fmtDateTime(b.createdAt)}</Td>
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
