import axios, { AxiosError } from "axios";

const TOKEN_KEY = "admin_token";

export const tokenStore = {
  get: (): string | null => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (token: string) => {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* private rejim — sessiya faqat xotirada */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* e'tiborsiz */
    }
  },
};

export const api = axios.create({ baseURL: "/api", timeout: 30_000 });

api.interceptors.request.use((cfg) => {
  const token = tokenStore.get();
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

/** Sessiya tugaganda (401) AuthContext foydalanuvchini login sahifasiga qaytaradi */
export const UNAUTHORIZED_EVENT = "auth:unauthorized";
/** Server "avval yangi parol o'rnating" desa (403 PASSWORD_CHANGE_REQUIRED) — parol sahifasiga */
export const PASSWORD_CHANGE_EVENT = "auth:password-change-required";

const PUBLIC_AUTH = ["/auth/login", "/auth/forgot-password", "/auth/verify-otp"];

api.interceptors.response.use(
  (res) => res,
  (err: unknown) => {
    if (err instanceof AxiosError) {
      const url = err.config?.url ?? "";
      if (err.response?.status === 401 && !PUBLIC_AUTH.some((p) => url.includes(p))) {
        tokenStore.clear();
        window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
      }
      const data: unknown = err.response?.data;
      if (err.response?.status === 403 && typeof data === "object" && data !== null && "code" in data && data.code === "PASSWORD_CHANGE_REQUIRED") {
        window.dispatchEvent(new Event(PASSWORD_CHANGE_EVENT));
      }
    }
    return Promise.reject(err);
  },
);

interface ErrorBody {
  error?: string;
  details?: Record<string, string[] | undefined>;
}

function isErrorBody(x: unknown): x is ErrorBody {
  return typeof x === "object" && x !== null;
}

/** Backend xatosidan foydalanuvchiga ko'rsatiladigan matn */
export function errorMessage(err: unknown): string {
  if (err instanceof AxiosError) {
    const data: unknown = err.response?.data;
    if (isErrorBody(data) && data.error) {
      const first = data.details ? Object.values(data.details).flat().find(Boolean) : undefined;
      return first ? `${data.error}: ${first}` : data.error;
    }
    if (err.code === "ECONNABORTED") return "Server javob bermadi (timeout)";
    if (!err.response) return "Serverga ulanib bo'lmadi";
  }
  return err instanceof Error ? err.message : "Noma'lum xatolik";
}

/**
 * Faylni yuklab olish (export): javob blob sifatida olinadi va brauzerda saqlanadi.
 * Katta fayl uzoq tayyorlanishi mumkin — umumiy 30 s timeout bu so'rovga qo'llanilmaydi.
 */
export async function downloadFile(url: string, params: Record<string, unknown>, fallbackName: string): Promise<void> {
  let res;
  try {
    res = await api.get<Blob>(url, { params, responseType: "blob", timeout: 0 });
  } catch (err) {
    // Xato javobi ham blob bo'lib keladi — JSON ga o'girib, odatdagi xabar ko'rsatiladi
    if (err instanceof AxiosError && err.response?.data instanceof Blob) {
      try {
        err.response.data = JSON.parse(await err.response.data.text()) as unknown;
      } catch {
        /* JSON emas — umumiy xabar */
      }
    }
    throw err;
  }
  const disposition = String(res.headers["content-disposition"] ?? "");
  const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? fallbackName;
  const href = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
