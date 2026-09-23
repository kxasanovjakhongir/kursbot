const TZ = "Asia/Tashkent";

const dateTimeFmt = new Intl.DateTimeFormat("ru-RU", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const dateFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });

export const fmtDateTime = (iso: string | null | undefined) => (iso ? dateTimeFmt.format(new Date(iso)) : "—");
export const fmtDate = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : "—");

/** 5240 -> "5 240" */
export const fmtNumber = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
export const fmtSum = (n: number) => `${fmtNumber(n)} so'm`;

export function fullName(u: { firstName: string | null; lastName?: string | null }): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ") || "—";
}

export function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "hozirgina";
  if (diff < 3600) return `${Math.floor(diff / 60)} daq. oldin`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} soat oldin`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} kun oldin`;
  return fmtDate(iso);
}

export const ORDER_STATUS: Record<string, { label: string; tone: "green" | "red" | "yellow" | "blue" | "gray" }> = {
  new: { label: "To'lov kutilmoqda", tone: "yellow" },
  receipt_sent: { label: "Chek tekshirilmoqda", tone: "blue" },
  rejected: { label: "Rad etilgan", tone: "red" },
  approved: { label: "Tasdiqlangan", tone: "green" },
  joined: { label: "Kanalga qo'shilgan", tone: "green" },
  expired: { label: "Muddati o'tgan", tone: "gray" },
  cancelled: { label: "Bekor qilingan", tone: "gray" },
  refunded: { label: "Pul qaytarilgan", tone: "gray" },
};
