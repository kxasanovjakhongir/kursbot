// Backend (/api/app) javoblari. BigInt ID lar satr sifatida keladi.

export type Lang = "uz" | "ru" | "en";
export type Role = "user" | "admin" | "superadmin";
export type Permission =
  | "catalog.view"
  | "profile.view"
  | "help.view"
  | "orders.review"
  | "stats.view"
  | "users.view"
  | "users.manage"
  | "broadcast.send"
  | "content.manage"
  | "products.manage"
  | "cards.manage"
  | "admins.manage"
  | "settings.manage"
  | "logs.view";

export interface Me {
  user: {
    id: string;
    telegramId: string;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    phone: string | null;
    language: Lang | null;
    newsEnabled: boolean;
    createdAt: string;
  };
  role: Role;
  lang: Lang;
  permissions: Permission[];
  stats: { products: number; orders: number; totalPaid: number };
  app: { botUsername: string | null; botUrl: string | null; supportUrl: string | null };
  /** Yaqinda reklama linki orqali kelgan darslik (asosiy sahifada birinchi) */
  featured: { code: string; title: string } | null;
}

/** Mini App startapp parametri — backend imzolangan initData'dan aniqlaydi */
export type Entry = { status: "ok"; productCode: string } | { status: "unavailable" };

export type Ownership = "none" | "owned" | "partial";

export interface Product {
  code: string;
  title: string;
  description: string;
  price: number;
  oldPrice: number | null;
  type: "channel" | "bundle";
  hasVideo: boolean;
  ownership: Ownership;
  // Kurs ma'lumotlari (to'ldirilmagan bo'lsa null)
  duration: string | null;
  lessonsCount: number | null;
  audience: string | null;
  startDate: string | null;
  teacher: string | null;
  benefits: string | null;
  program: string | null;
}

export type OrderStatus = "new" | "receipt_sent" | "rejected" | "approved" | "joined" | "expired" | "cancelled" | "refunded";

export interface OrderSummary {
  id: string;
  status: OrderStatus;
  amount: number;
  product: { code: string; title: string };
  createdAt: string;
  expiresAt: string;
  canPay: boolean;
  canUploadReceipt: boolean;
  canCancel: boolean;
}

export interface OrderDetail extends OrderSummary {
  card: { number: string; holder: string; bank: string | null } | null;
  attempts: number;
  maxAttempts: number;
  shortfall: number | null;
  rejectReason: string | null;
  lastReceiptAt: string | null;
  paidAt: string | null;
}

export interface Purchase {
  id: string;
  product: { code: string; title: string };
  joined: boolean;
  /** Kanalda qolish muddati; null — muddatsiz */
  expiresAt: string | null;
  createdAt: string;
}

export type NotificationKind = "info" | "success" | "warning" | "order" | "message";

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  text: string;
  createdAt: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

// ---------- Admin ----------

export interface Stats {
  users: { total: number; active: number; blocked: number; banned: number; active30d: number; newToday: number; newWeek: number; newMonth: number };
  messagesToday: number;
  broadcastsSent: number;
  sales: { pendingReceipts: number; ordersToday: number; revenueToday: number; revenueMonth: number };
}

export interface PendingReceipt {
  orderId: string;
  amount: number;
  attempts: number;
  shortfall: number | null;
  product: { title: string };
  user: { firstName: string | null; lastName: string | null; username: string | null; phone: string | null; isForeign: boolean };
  receipt: { fileType: "photo" | "pdf" | "image"; isDuplicate: boolean; createdAt: string } | null;
}

export interface RejectReason {
  code: string;
  label: string;
  needsInput: boolean;
}

export interface AdminUser {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  language: string | null;
  isBlocked: boolean;
  isBanned: boolean;
  createdAt: string;
  lastSeenAt: string;
}
