import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, PASSWORD_CHANGE_EVENT, tokenStore, UNAUTHORIZED_EVENT } from "../lib/api";
import type { PanelUser } from "../lib/types";

interface AuthValue {
  user: PanelUser | null;
  loading: boolean;
  isSuper: boolean;
  login: (email: string, password: string) => Promise<void>;
  /** "Parolni unutdim": emaildagi kod bilan kirish (keyin yangi parol o'rnatish majburiy) */
  loginWithOtp: (email: string, code: string) => Promise<void>;
  /** Yangi token va foydalanuvchi (parol o'zgartirilgach) */
  setSession: (token: string, u: PanelUser) => void;
  logout: () => Promise<void>;
  setUser: (u: PanelUser) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PanelUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tokenStore.get()) {
      setLoading(false);
      return;
    }
    api
      .get<{ user: PanelUser }>("/auth/me")
      .then((r) => setUser(r.data.user))
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    // Boshqa tabda yoki serverda bayroq qo'yilgan — sahifalar RequireAuth orqali parol sahifasiga yo'naltiriladi
    const onPasswordChange = () => setUser((u) => (u && !u.mustChangePassword ? { ...u, mustChangePassword: true } : u));
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    window.addEventListener(PASSWORD_CHANGE_EVENT, onPasswordChange);
    return () => {
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
      window.removeEventListener(PASSWORD_CHANGE_EVENT, onPasswordChange);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post<{ token: string; user: PanelUser }>("/auth/login", { email, password });
    tokenStore.set(r.data.token);
    setUser(r.data.user);
  }, []);

  const loginWithOtp = useCallback(async (email: string, code: string) => {
    const r = await api.post<{ token: string; user: PanelUser }>("/auth/verify-otp", { email, code });
    tokenStore.set(r.data.token);
    setUser(r.data.user);
  }, []);

  const setSession = useCallback((token: string, u: PanelUser) => {
    tokenStore.set(token);
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => undefined);
    tokenStore.clear();
    setUser(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ user, loading, isSuper: user?.role === "superadmin", login, loginWithOtp, setSession, logout, setUser }),
    [user, loading, login, loginWithOtp, setSession, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth AuthProvider ichida ishlatilishi kerak");
  return ctx;
}
