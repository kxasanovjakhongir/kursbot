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

api.interceptors.response.use(
  (res) => res,
  (err: unknown) => {
    if (err instanceof AxiosError && err.response?.status === 401 && !err.config?.url?.includes("/auth/login")) {
      tokenStore.clear();
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
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
