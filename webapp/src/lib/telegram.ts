/**
 * Telegram Mini App SDK (https://core.telegram.org/bots/webapps) — faqat ishlatiladigan qismi typelangan.
 * Telegram'dan tashqarida (oddiy brauzer) ochilsa ham ilova yiqilmasligi uchun barcha chaqiruvlar xavfsiz.
 */

interface WebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

interface BottomButton {
  show(): void;
  hide(): void;
}

interface BackButton {
  isVisible: boolean;
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

interface HapticFeedback {
  impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
  notificationOccurred(type: "error" | "success" | "warning"): void;
  selectionChanged(): void;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: WebAppUser; start_param?: string };
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
  isExpanded: boolean;
  BackButton: BackButton;
  MainButton: BottomButton;
  HapticFeedback: HapticFeedback;
  ready(): void;
  expand(): void;
  close(): void;
  isVersionAtLeast(version: string): boolean;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  openTelegramLink(url: string): void;
  openLink(url: string): void;
  showConfirm(message: string, cb: (ok: boolean) => void): void;
  requestContact(cb: (shared: boolean) => void): void;
  onEvent(event: "themeChanged" | "viewportChanged", cb: () => void): void;
  offEvent(event: "themeChanged" | "viewportChanged", cb: () => void): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/** SDK yuklangan va Telegram ichida ochilgan bo'lsa (initData bor) */
export function webApp(): TelegramWebApp | null {
  const wa = window.Telegram?.WebApp;
  return wa && wa.initData ? wa : null;
}

export function initData(): string {
  return webApp()?.initData || (import.meta.env.DEV ? (import.meta.env.VITE_DEV_INIT_DATA ?? "") : "");
}

/** Faqat ko'rsatish uchun (ism, rasm). Ishonchli ma'lumot — backend tekshirgan /me */
export function unsafeUser(): WebAppUser | null {
  return webApp()?.initDataUnsafe.user ?? null;
}

function applyColorScheme(scheme: "light" | "dark"): void {
  document.documentElement.dataset.theme = scheme;
}

export function setupWebApp(): void {
  const wa = webApp();
  if (!wa) {
    // Brauzerda — tizim temasi
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    applyColorScheme(mq.matches ? "dark" : "light");
    mq.addEventListener("change", (e) => applyColorScheme(e.matches ? "dark" : "light"));
    return;
  }
  applyColorScheme(wa.colorScheme);
  // Foydalanuvchi Telegram temasini almashtirsa — ilova ham darhol almashadi
  wa.onEvent("themeChanged", () => applyColorScheme(wa.colorScheme));
  wa.ready();
  wa.expand();
  // Sarlavha va fon Telegram temasi bilan bir xil — ilova "Telegram ichida" ko'rinadi
  if (wa.isVersionAtLeast("6.1")) {
    wa.setHeaderColor("secondary_bg_color");
    wa.setBackgroundColor("secondary_bg_color");
  }
}

export const haptic = {
  success: () => webApp()?.HapticFeedback.notificationOccurred("success"),
  error: () => webApp()?.HapticFeedback.notificationOccurred("error"),
  tap: () => webApp()?.HapticFeedback.impactOccurred("light"),
  select: () => webApp()?.HapticFeedback.selectionChanged(),
};

/** Telegram ichida native tasdiqlash oynasi, tashqarida — brauzer confirm */
export function confirmDialog(message: string): Promise<boolean> {
  const wa = webApp();
  if (wa?.isVersionAtLeast("6.2")) return new Promise((resolve) => wa.showConfirm(message, resolve));
  return Promise.resolve(window.confirm(message));
}

/** t.me havolalari Telegram ichida ochiladi (Mini App yopilmaydi) */
export function openTelegramLink(url: string): void {
  const wa = webApp();
  if (wa && url.startsWith("https://t.me/")) wa.openTelegramLink(url);
  else window.open(url, "_blank", "noopener");
}

/** Telefon: foydalanuvchi roziligi bilan kontakt botga yuboriladi; backend uni bot orqali saqlaydi */
export function requestContact(): Promise<boolean> {
  const wa = webApp();
  if (!wa?.isVersionAtLeast("6.9")) return Promise.resolve(false);
  return new Promise((resolve) => wa.requestContact(resolve));
}

export function closeApp(): void {
  webApp()?.close();
}

export function backButton(): BackButton | null {
  const wa = webApp();
  return wa?.isVersionAtLeast("6.1") ? wa.BackButton : null;
}
