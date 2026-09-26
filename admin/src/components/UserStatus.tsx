import type { TelegramUser } from "../lib/types";
import { Badge } from "./ui";

/** Foydalanuvchi holati: admin cheklovi ustun, keyin botni bloklagani */
export function UserStatus({ user }: { user: Pick<TelegramUser, "isBanned" | "isBlocked"> }) {
  if (user.isBanned) return <Badge tone="red">Cheklangan</Badge>;
  if (user.isBlocked) return <Badge tone="yellow">Botni bloklagan</Badge>;
  return <Badge tone="green">Faol</Badge>;
}
