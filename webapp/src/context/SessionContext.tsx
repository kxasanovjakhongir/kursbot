import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, onUnauthorized, setToken } from "../lib/api";
import { initData, unsafeUser } from "../lib/telegram";
import type { Entry, Lang, Me, Permission } from "../lib/types";
import { guessLang, translator, type Translate } from "../i18n";

export type SessionState =
  | { status: "loading" }
  | { status: "outside" }
  | { status: "error"; reason: "auth_failed" | "banned" | "maintenance" | "network" }
  | { status: "ready"; me: Me };

interface SessionValue {
  state: SessionState;
  lang: Lang;
  t: Translate;
  /** Faqat status=ready da chaqiriladi */
  me: () => Me;
  can: (p: Permission) => boolean;
  setMe: (me: Me) => void;
  refresh: () => Promise<Me | null>;
  retry: () => void;
  /** startapp natijasi — bir marta olinadi (keyingi chaqiruvda null) */
  takeEntry: () => Entry | null;
}

const SessionContext = createContext<SessionValue | null>(null);

function reasonOf(err: unknown): "auth_failed" | "banned" | "maintenance" | "network" {
  if (err instanceof ApiError) {
    if (err.code === "banned") return "banned";
    if (err.code === "maintenance") return "maintenance";
    if (err.status === 0) return "network";
  }
  return "auth_failed";
}

/**
 * Kirish: Telegram initData → backend tekshiradi → token + profil.
 * Frontend Telegram ma'lumotiga ishonmaydi — rol, til, telefon faqat backend javobidan olinadi.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  // Faqat birinchi kirishda: token eskirib qayta kirilganda foydalanuvchi boshqa sahifaga otib yuborilmaydi
  const entryRef = useRef<Entry | null>(null);
  const entryUsed = useRef(false);

  const login = useCallback(async (): Promise<Me> => {
    const res = await api.post<{ token: string; me: Me; entry: Entry | null }>("/auth/telegram", { initData: initData() });
    setToken(res.token);
    if (!entryUsed.current) entryRef.current = res.entry;
    return res.me;
  }, []);

  useEffect(() => {
    if (!initData()) {
      setState({ status: "outside" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    login()
      .then((me) => !cancelled && setState({ status: "ready", me }))
      .catch((err: unknown) => !cancelled && setState({ status: "error", reason: reasonOf(err) }));
    // Token eskirsa (12 soat) — shu initData bilan jimgina qayta kirish
    onUnauthorized(async () => {
      try {
        const me = await login();
        setState({ status: "ready", me });
        return true;
      } catch (err) {
        setState({ status: "error", reason: reasonOf(err) });
        return false;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [login, attempt]);

  const lang: Lang = state.status === "ready" ? state.me.lang : guessLang(unsafeUser()?.language_code);

  const value = useMemo<SessionValue>(() => {
    const me = () => {
      const s = stateRef.current;
      if (s.status !== "ready") throw new Error("Sessiya tayyor emas");
      return s.me;
    };
    return {
      state,
      lang,
      t: translator(lang),
      me,
      can: (p) => state.status === "ready" && state.me.permissions.includes(p),
      setMe: (m) => setState({ status: "ready", me: m }),
      refresh: async () => {
        try {
          const m = await api.get<Me>("/me");
          setState({ status: "ready", me: m });
          return m;
        } catch (err) {
          if (err instanceof ApiError && (err.code === "banned" || err.code === "maintenance")) setState({ status: "error", reason: reasonOf(err) });
          return null;
        }
      },
      retry: () => setAttempt((a) => a + 1),
      takeEntry: () => {
        const e = entryRef.current;
        entryRef.current = null;
        entryUsed.current = true;
        return e;
      },
    };
  }, [state, lang]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession SessionProvider ichida ishlatilishi kerak");
  return ctx;
}
