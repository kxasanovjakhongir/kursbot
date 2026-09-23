// Backend javoblari. BigInt maydonlar (ID, Telegram ID) JSON da satr sifatida keladi.

export type Role = "admin" | "superadmin";

export interface PanelUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export interface DashboardStats {
  users: { total: number; active: number; blocked: number; active30d: number; newToday: number; newWeek: number; newMonth: number };
  messagesToday: number;
  broadcastsSent: number;
  sales: { pendingReceipts: number; ordersToday: number; revenueToday: number; revenueMonth: number };
}

export interface BotStatus {
  online: boolean;
  reachable: boolean;
  name?: string;
  username?: string;
  id?: number;
  error?: string;
  mode: "polling" | "webhook";
  maintenance: boolean;
  totalUsers: number;
  checkedAt: string;
}

export interface TelegramUser {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
  phone: string | null;
  isBlocked: boolean;
  firstSource: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export type OrderStatus = "new" | "receipt_sent" | "rejected" | "approved" | "joined" | "expired" | "cancelled" | "refunded";

export interface OrderSummary {
  id: string;
  amount: number;
  status: OrderStatus;
  createdAt: string;
  product: { title: string; code: string };
}

export interface TelegramUserDetail extends TelegramUser {
  firstProduct: string | null;
  lastSource: string | null;
  isForeign: boolean;
  orders: OrderSummary[];
  grants: { id: string; joinedAt: string | null; product: { title: string } }[];
  _count: { messages: number };
}

export type Direction = "incoming" | "outgoing";
export type MessageType = "text" | "photo" | "video" | "document" | "other";

export interface ChatMessage {
  id: string;
  userId: string;
  direction: Direction;
  messageType: MessageType;
  text: string | null;
  createdAt: string;
  user?: { id: string; firstName: string | null; lastName: string | null; username: string | null };
}

export type Audience = "all" | "active" | "specific";
export type BroadcastType = Exclude<MessageType, "other">;

export interface Broadcast {
  id: number;
  messageType: MessageType;
  text: string | null;
  fileName: string | null;
  audience: Audience;
  status: "pending" | "sending" | "completed" | "failed";
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdBy: { id: number; name: string } | null;
}

export interface BroadcastDetail {
  broadcast: Broadcast;
  pending: number;
  failures: {
    id: string;
    status: "failed" | "skipped";
    error: string | null;
    user: { id: string; firstName: string | null; username: string | null; telegramId: string };
  }[];
}

export interface BotCommand {
  id: number;
  command: string;
  description: string;
  response: string;
  isActive: boolean;
  updatedAt: string;
}

export interface MenuItem {
  id: number;
  name: string;
  command: string;
  description: string;
  order: number;
  isActive: boolean;
}

export interface BotSettings {
  botName: string;
  botUsername: string;
  botToken: string;
  tokenSource: "env" | "database";
  welcomeMessage: string;
  defaultLanguage: "uz" | "ru" | "en";
  maintenanceMode: boolean;
  workStart: string;
  workEnd: string;
}

export interface ActivityLog {
  id: string;
  action: string;
  description: string;
  ipAddress: string | null;
  createdAt: string;
  panelUser: { id: number; name: string; email: string } | null;
}

export interface Order {
  id: string;
  amount: number;
  status: OrderStatus;
  attempts: number;
  source: string | null;
  rejectReason: string | null;
  createdAt: string;
  paidAt: string | null;
  expiresAt: string;
  user: { id: string; firstName: string | null; lastName: string | null; username: string | null; phone: string | null };
  product: { title: string; code: string };
}

export interface OrderDetail extends Order {
  reviewedAt: string | null;
  reviewedBy: { name: string | null } | null;
  reviewedByPanel: { name: string } | null;
  card: { numberMasked: string; holder: string } | null;
  receipts: { id: string; fileType: "photo" | "pdf" | "image"; isDuplicate: boolean; createdAt: string }[];
}

export interface Product {
  id: number;
  code: string;
  title: string;
  description: string;
  price: number;
  oldPrice: number | null;
  videoFileId: string | null;
  type: "channel" | "bundle";
  channelId: string | null;
  bundleCodes: string[];
  isActive: boolean;
}

export interface PaymentCard {
  id: number;
  number: string;
  numberMasked: string;
  holder: string;
  bank: string | null;
  monthlyLimit: number | null;
  isActive: boolean;
  revenue30d: number;
  orders30d: number;
}

export interface ReceiptRef {
  id: string;
  fileType: "photo" | "pdf" | "image";
  isDuplicate: boolean;
  createdAt: string;
}

export interface PendingOrder extends Order {
  card: { numberMasked: string; holder: string } | null;
  receipts: ReceiptRef[];
}

export interface RejectReason {
  code: string;
  label: string;
  needsInput: boolean;
}
