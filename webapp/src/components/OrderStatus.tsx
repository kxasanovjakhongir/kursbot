import type { OrderStatus } from "../lib/types";
import type { MessageKey } from "../i18n";
import { useSession } from "../context/SessionContext";
import { Badge } from "./ui";

const STATUS: Record<OrderStatus, { key: MessageKey; tone: "green" | "blue" | "yellow" | "red" | "gray" }> = {
  new: { key: "status_new", tone: "yellow" },
  receipt_sent: { key: "status_receipt_sent", tone: "blue" },
  rejected: { key: "status_rejected", tone: "red" },
  approved: { key: "status_approved", tone: "green" },
  joined: { key: "status_joined", tone: "green" },
  expired: { key: "status_expired", tone: "gray" },
  cancelled: { key: "status_cancelled", tone: "gray" },
  refunded: { key: "status_refunded", tone: "gray" },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useSession();
  const s = STATUS[status];
  return <Badge tone={s.tone}>{t(s.key)}</Badge>;
}
