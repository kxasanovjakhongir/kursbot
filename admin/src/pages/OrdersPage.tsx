import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { fmtDateTime, fmtSum, fullName, ORDER_STATUS, PAYMENT_METHOD_LABEL } from "../lib/format";
import type { Order, Paged } from "../lib/types";
import { useAsync } from "../hooks/useAsync";
import { AsyncView, Badge, Card, EmptyState, PageHeader, Pagination, Select, Table, Td, Th } from "../components/ui";

export default function OrdersPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const method = params.get("method") ?? "";
  const paid = params.get("paid") === "1";
  const page = Number(params.get("page") ?? 1);

  const orders = useAsync(
    () => api.get<Paged<Order>>("/orders", { params: { status: status || undefined, method: method || undefined, paid: paid ? 1 : undefined, page } }).then((r) => r.data),
    [status, method, paid, page],
  );

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== "page") next.delete("page");
    setParams(next);
  };

  return (
    <>
      <PageHeader title="Buyurtmalar" subtitle="Cheklar Telegram admin guruhida tasdiqlanadi; bu yerda — kuzatish" />
      <Card>
        <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row">
          <Select className="sm:w-60" value={paid ? "1" : ""} onChange={(e) => set("paid", e.target.value)}>
            <option value="">Barcha buyurtmalar</option>
            <option value="1">Faqat to'laganlar</option>
          </Select>
          <Select className="sm:w-60" value={status} onChange={(e) => set("status", e.target.value)}>
            <option value="">Barcha holatlar</option>
            {Object.entries(ORDER_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
          <Select className="sm:w-60" value={method} onChange={(e) => set("method", e.target.value)}>
            <option value="">Barcha to'lov usullari</option>
            {Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <AsyncView state={orders}>
          {(d) =>
            d.items.length === 0 ? (
              <EmptyState title="Buyurtmalar yo'q" />
            ) : (
              <>
                <Table
                  head={
                    <tr>
                      <Th>#</Th>
                      <Th>Mijoz</Th>
                      <Th>Mahsulot</Th>
                      <Th>Summa</Th>
                      <Th>Holat</Th>
                      <Th>To'lov</Th>
                      <Th className="hidden md:table-cell">Manba</Th>
                      <Th className="hidden md:table-cell">Sana</Th>
                    </tr>
                  }
                >
                  {d.items.map((o) => (
                    <tr key={o.id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/orders/${o.id}`)}>
                      <Td className="font-medium text-blue-600">#{o.id}</Td>
                      <Td className="whitespace-nowrap">
                        {fullName(o.user)}
                        <div className="text-xs text-gray-500">{o.user.phone ?? ""}</div>
                      </Td>
                      <Td>{o.product.title}</Td>
                      <Td className="whitespace-nowrap tabular-nums">{fmtSum(o.amount)}</Td>
                      <Td>
                        <Badge tone={ORDER_STATUS[o.status]?.tone ?? "gray"}>{ORDER_STATUS[o.status]?.label ?? o.status}</Badge>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {o.paidAt ? (
                          <>
                            {PAYMENT_METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod}
                            <div className="text-xs text-gray-500">{fmtDateTime(o.paidAt)}</div>
                          </>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </Td>
                      <Td className="hidden text-gray-500 md:table-cell">{o.source ?? "—"}</Td>
                      <Td className="hidden whitespace-nowrap text-gray-500 md:table-cell">{fmtDateTime(o.createdAt)}</Td>
                    </tr>
                  ))}
                </Table>
                <Pagination page={d.page} pages={d.pages} total={d.total} onPage={(p) => set("page", String(p))} />
              </>
            )
          }
        </AsyncView>
      </Card>
    </>
  );
}
