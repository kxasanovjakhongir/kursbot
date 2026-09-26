const BASE = `${(import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "")}/api/app`;

/** Backend xatosi: status + mashina uchun kod (details.code) — UI matni shunga qarab tanlanadi */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly details: Record<string, unknown>;

  constructor(status: number, message: string, code: string | null, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let token: string | null = null;
/** Token eskirsa — sessiya qayta kiradi (initData bilan) va so'rov bir marta qaytariladi */
let reauth: (() => Promise<boolean>) | null = null;

export function setToken(t: string | null): void {
  token = t;
}

export function onUnauthorized(handler: () => Promise<boolean>): void {
  reauth = handler;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

async function toError(res: Response): Promise<ApiError> {
  const body: unknown = await res.json().catch(() => null);
  const message = isRecord(body) && typeof body.error === "string" ? body.error : res.statusText;
  const details = isRecord(body) && isRecord(body.details) ? body.details : {};
  return new ApiError(res.status, message, typeof details.code === "string" ? details.code : null, details);
}

async function request<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, "Network error", "network");
  }
  if (res.status === 401 && !retried && reauth && path !== "/auth/telegram" && (await reauth())) {
    return request<T>(method, path, body, true);
  }
  if (!res.ok) throw await toError(res);
  const data: unknown = await res.json();
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, form),
  /** Himoyalangan fayl (chek rasmi) — blob URL sifatida */
  async blobUrl(path: string): Promise<string> {
    const res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw await toError(res);
    return URL.createObjectURL(await res.blob());
  },
};
