import { useState } from "react";
import { api } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import type { ActivityLog, Paged } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { AsyncView, Badge, Card, EmptyState, PageHeader, Pagination, Select, Table, Td, Th } from "../components/ui";

type LogsPage = Paged<ActivityLog> & { actions: string[] };

const tone = (a: string) =>
  a.startsWith("DELETE") || a === "LOGIN_FAILED" ? "red" : a.startsWith("CREATE") ? "green" : a.startsWith("LOGIN") || a === "LOGOUT" ? "gray" : "blue";

export default function ActivityLogsPage() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const logs = useAsync(() => api.get<LogsPage>("/activity-logs", { params: { action: action || undefined, page } }).then((r) => r.data), [action, page]);

  return (
    <>
      <PageHeader title="Faoliyat loglari" subtitle="Adminlarning barcha harakatlari" />
      <Card>
        <div className="border-b border-gray-100 p-4">
          <Select
            className="sm:w-64"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Barcha harakatlar</option>
            {(logs.data?.actions ?? []).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </div>
        <AsyncView state={logs}>
          {(d) =>
            d.items.length === 0 ? (
              <EmptyState title="Loglar yo'q" />
            ) : (
              <>
                <Table
                  head={
                    <tr>
                      <Th>Sana</Th>
                      <Th>Admin</Th>
                      <Th>Harakat</Th>
                      <Th>Tavsif</Th>
                      <Th className="hidden md:table-cell">IP</Th>
                    </tr>
                  }
                >
                  {d.items.map((l) => (
                    <tr key={l.id}>
                      <Td className="whitespace-nowrap text-gray-500">{fmtDateTime(l.createdAt)}</Td>
                      <Td className="whitespace-nowrap">{l.panelUser?.name ?? <span className="text-gray-400">—</span>}</Td>
                      <Td>
                        <Badge tone={tone(l.action)}>{l.action}</Badge>
                      </Td>
                      <Td className="min-w-[200px] text-gray-700">{l.description}</Td>
                      <Td className="hidden font-mono text-xs text-gray-500 md:table-cell">{l.ipAddress ?? "—"}</Td>
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
