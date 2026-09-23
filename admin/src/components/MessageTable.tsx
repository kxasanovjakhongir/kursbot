import { Link } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { fmtDateTime, fullName } from "../lib/format";
import type { ChatMessage } from "../lib/types";
import { Badge, Table, Td, Th } from "./ui";

const TYPE_LABEL = { text: "Matn", photo: "Rasm", video: "Video", document: "Hujjat", other: "Boshqa" } as const;

export function MessageTable({ items, showUser }: { items: ChatMessage[]; showUser?: boolean }) {
  return (
    <Table
      head={
        <tr>
          <Th>Yo'nalish</Th>
          {showUser && <Th>Foydalanuvchi</Th>}
          <Th>Xabar</Th>
          <Th>Sana</Th>
        </tr>
      }
    >
      {items.map((m) => (
        <tr key={m.id} className="align-top">
          <Td>
            {m.direction === "incoming" ? (
              <Badge tone="blue">
                <ArrowDownLeft className="h-3 w-3" /> INCOMING
              </Badge>
            ) : (
              <Badge tone="gray">
                <ArrowUpRight className="h-3 w-3" /> OUTGOING
              </Badge>
            )}
          </Td>
          {showUser && (
            <Td className="whitespace-nowrap">
              {m.user ? (
                <Link to={`/telegram-users/${m.user.id}`} className="text-blue-600 hover:underline">
                  {fullName(m.user)}
                </Link>
              ) : (
                "—"
              )}
            </Td>
          )}
          <Td className="min-w-[240px] max-w-xl">
            {m.messageType !== "text" && <span className="mr-2 text-xs font-medium text-gray-400">[{TYPE_LABEL[m.messageType]}]</span>}
            <span className="whitespace-pre-wrap break-words text-gray-800">{m.text ?? ""}</span>
          </Td>
          <Td className="whitespace-nowrap text-gray-500">{fmtDateTime(m.createdAt)}</Td>
        </tr>
      ))}
    </Table>
  );
}
