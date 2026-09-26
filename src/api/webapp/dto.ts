import type { Notification, Order, OrderStatus, Product, User } from "@prisma/client";
import type { Ownership } from "../../services/products";
import { stripHtml } from "../../lib/format";

/** Mini App ga boradigan ma'lumotlar — faqat kerakli maydonlar (ichki ID lar, file_id lar, admin izohlari chiqmaydi) */

export function userDto(u: User) {
  return {
    id: u.id.toString(),
    telegramId: u.telegramId.toString(),
    firstName: u.firstName,
    lastName: u.lastName,
    username: u.username,
    phone: u.phone,
    language: u.language,
    newsEnabled: u.newsEnabled,
    createdAt: u.createdAt,
  };
}

export function productDto(p: Product, ownership: Ownership["kind"]) {
  return {
    code: p.code,
    title: p.title,
    description: p.description,
    price: p.price,
    oldPrice: p.oldPrice && p.oldPrice > p.price ? p.oldPrice : null,
    type: p.type,
    hasVideo: !!p.videoFileId,
    ownership,
    // Kurs ma'lumotlari (to'ldirilganlari)
    duration: p.duration,
    lessonsCount: p.lessonsCount,
    audience: p.audience,
    startDate: p.startDate ? p.startDate.toISOString().slice(0, 10) : null,
    teacher: p.teacher,
    benefits: p.benefits,
    program: p.program,
  };
}

/** Mijoz o'zi bajara oladigan amallar — UI tugmalari shunga qarab chiqadi */
function orderActions(o: Pick<Order, "status" | "expiresAt">) {
  const open = (o.status === "new" || o.status === "rejected") && o.expiresAt > new Date();
  return { canPay: open, canUploadReceipt: open, canCancel: o.status === "new" && open };
}

export function orderListDto(o: Order & { product: { code: string; title: string } }) {
  return {
    id: o.id.toString(),
    status: o.status,
    amount: o.amount,
    product: o.product,
    createdAt: o.createdAt,
    expiresAt: o.expiresAt,
    ...orderActions(o),
  };
}

const PAYABLE: OrderStatus[] = ["new", "rejected"];

export function orderDetailDto(
  o: Order & {
    product: { code: string; title: string };
    card: { number: string; holder: string; bank: string | null } | null;
    receipts: { id: bigint; createdAt: Date }[];
  },
  maxAttempts: number,
) {
  return {
    ...orderListDto(o),
    // Karta raqami faqat to'lov kutilayotganda (botdagi kabi to'liq — nusxalash uchun)
    card: o.card && PAYABLE.includes(o.status) ? o.card : null,
    attempts: o.attempts,
    maxAttempts,
    shortfall: o.status === "rejected" ? o.shortfall : null,
    rejectReason: o.status === "rejected" ? o.rejectReason : null,
    lastReceiptAt: o.receipts[0]?.createdAt ?? null,
    paidAt: o.paidAt,
  };
}

export function notificationDto(n: Notification) {
  return { id: n.id.toString(), kind: n.kind, text: stripHtml(n.text), createdAt: n.createdAt };
}
