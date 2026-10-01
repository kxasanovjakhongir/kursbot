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
  /** Biriktirilgan Telegram hisobi — shu odam botda ham admin */
  telegramId: string | null;
  /** Botdagi holati (ro'yxatda): faol bo'lsa rol */
  bot?: { role: Role } | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export interface DashboardStats {
  users: { total: number; active: number; blocked: number; banned: number; active30d: number; newToday: number; newWeek: number; newMonth: number };
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
  /** Botda tanlangan til (uz/ru/en) */
  language: string | null;
  phone: string | null;
  /** Foydalanuvchi botni bloklagan */
  isBlocked: boolean;
  /** Admin tomonidan cheklangan */
  isBanned: boolean;
  firstSource: string | null;
  lastProduct?: string | null;
  lastProductTitle?: string | null;
  /** Telefon ulashgan vaqt (ro'yxatdan o'tish) */
  registeredAt?: string | null;
  createdAt: string;
  lastSeenAt: string;
  /** Birinchi kampaniya linki (first-touch) — ro'yxatda */
  firstLink?: { code: string; source: string; campaign: string | null; product: { title: string } } | null;
  /** To'langan buyurtmalar — ro'yxatda */
  purchase?: { count: number; amount: number; lastAt: string | null } | null;
}

export interface UserFilters {
  products: { id: number; title: string }[];
  sources: string[];
  campaigns: string[];
}

export type OrderStatus = "new" | "receipt_sent" | "rejected" | "approved" | "joined" | "expired" | "cancelled" | "refunded";

export interface OrderSummary {
  id: string;
  amount: number;
  status: OrderStatus;
  createdAt: string;
  product: { title: string; code: string };
}

export type GrantRevokeReason = "expired" | "removed" | "banned";

/** Yopiq kanalga kirish huquqi */
export interface AccessGrant {
  id: string;
  joinedAt: string | null;
  /** Kanalda qolish muddati; null — muddatsiz */
  expiresAt: string | null;
  revokedAt: string | null;
  revokeReason: GrantRevokeReason | null;
  createdAt: string;
  product: { title: string; channelId: string | null };
}

export interface TelegramUserDetail extends TelegramUser {
  firstProduct: string | null;
  lastSource: string | null;
  isForeign: boolean;
  orders: OrderSummary[];
  grants: AccessGrant[];
  bannedAt: string | null;
  newsEnabled: boolean;
  _count: { messages: number; notifications: number };
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

export type Audience = "all" | "active" | "specific" | "buyers" | "non_buyers" | "admins" | "product";
export type BroadcastType = Exclude<MessageType, "other">;

export interface Broadcast {
  id: number;
  messageType: MessageType;
  text: string | null;
  fileName: string | null;
  audience: Audience;
  product: { id: number; title: string } | null;
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
  cancelledAt: string | null;
  cancelReason: string | null;
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
  cancelledBy: { name: string } | null;
  card: { numberMasked: string; holder: string } | null;
  receipts: { id: string; fileType: "photo" | "pdf" | "image"; isDuplicate: boolean; createdAt: string }[];
}

/** Cheklar tarixi: ko'rib chiqilgan buyurtma (oxirgi chek birinchi) */
export type ReceiptHistoryItem = Omit<OrderDetail, "card">;

export interface CancelResult {
  ok: true;
  status: "cancelled" | "refunded";
  revoked: number;
}

/** Texnik xato (bir xillari guruhlangan) */
export interface ErrorLogItem {
  id: string;
  level: "error" | "fatal";
  message: string;
  errorType: string | null;
  errorText: string | null;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
}

export interface ErrorLogDetail extends ErrorLogItem {
  stack: string | null;
  context: Record<string, unknown> | null;
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
  /** Kanalda qolish muddati (kun); null — muddatsiz */
  accessDays: number | null;
  isActive: boolean;
  // Kurs ma'lumotlari (ixtiyoriy)
  duration: string | null;
  lessonsCount: number | null;
  audience: string | null;
  startDate: string | null;
  teacher: string | null;
  benefits: string | null;
  program: string | null;
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

export interface LinkStats {
  clicks: number;
  uniqueClicks: number;
  visits: number;
  users: number;
  newUsers: number;
  registered: number;
  viewed: number;
  orders: number;
  paid: number;
  buyers: number;
  revenue: number;
  conversion: number;
}

/** Kampaniya (deep link) havolasi */
export interface CampaignLink {
  id: number;
  code: string;
  name: string | null;
  source: string;
  campaign: string | null;
  medium: string | null;
  isActive: boolean;
  createdAt: string;
  product: { id: number; code: string; title: string; isActive: boolean };
  createdBy: { name: string } | null;
  /** tracked — bosishlarni ham sanaydigan redirect (reklama uchun tavsiya) */
  urls: { bot: string | null; tracked: string | null };
  stats: LinkStats | null;
}

export interface LinksMeta {
  products: { id: number; code: string; title: string; isActive: boolean }[];
  botUsername: string | null;
}

// ---------- Marketing analitikasi ----------

export interface AnalyticsSegment {
  course: string | null;
  source: string;
  campaign: string | null;
  clicks: number;
  users: number;
  registered: number;
  leads: number;
  purchases: number;
  revenue: number;
  conversion: number;
}

export interface Analytics {
  totals: { users: number; newUsers: number; registered: number; leads: number; purchases: number; buyers: number; revenue: number; conversion: number };
  funnel: { clicks: number; started: number; registered: number; viewed: number; ordered: number; purchased: number };
  series: { day: string; newUsers: number; registered: number; orders: number; purchases: number; revenue: number }[];
  courses: {
    productId: number;
    code: string;
    title: string;
    interested: number;
    started: number;
    viewed: number;
    leads: number;
    purchases: number;
    buyers: number;
    revenue: number;
    conversion: number;
  }[];
  sources: AnalyticsSegment[];
  campaigns: AnalyticsSegment[];
}

// ---------- Kurs darslari (videolar) ----------

export interface LessonCourse {
  id: number;
  code: string;
  title: string;
  isActive: boolean;
  lessons: number;
}

export interface Lesson {
  id: number;
  productId: number;
  title: string;
  caption: string | null;
  description: string | null;
  mediaType: "video" | "document";
  fileName: string | null;
  mimeType: string | null;
  /** Bayt (BigInt — satr sifatida) */
  fileSize: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  product: { title: string };
}
