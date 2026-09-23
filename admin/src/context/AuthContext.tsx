import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, tokenStore, UNAUTHORIZED_EVENT } from "../lib/api";
import type { PanelUser } from "../lib/types";

interface AuthValue {
  user: PanelUser | null;
  loading: boolean;
  isSuper: boolean;
  login: (email: string, password: string) => Promise<void>;
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
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post<{ token: string; user: PanelUser }>("/auth/login", { email, password });
    tokenStore.set(r.data.token);
    setUser(r.data.user);
  }, []);

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => undefined);
    tokenStore.clear();
    setUser(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ user, loading, isSuper: user?.role === "superadmin", login, logout, setUser }),
    [user, loading, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth AuthProvider ichida ishlatilishi kerak");
  return ctx;
}
