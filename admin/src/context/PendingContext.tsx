import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { useToast } from "./ToastContext";
import { useAuth } from "./AuthContext";

interface PendingValue {
  count: number;
  /** Ochiq (hal qilinmagan) texnik xatolar — faqat super admin uchun */
  errorsCount: number;
  latestReceiptId: string | null;
  refresh: () => void;
}

const PendingContext = createContext<PendingValue | null>(null);
const POLL_MS = 10_000;
const ERRORS_POLL_MS = 30_000;
const BASE_TITLE = "Bot Admin Panel";

/** Yangi cheklarni kuzatadi (menyudagi son, toast, brauzer bildirishnomasi) va ochiq texnik xatolar sonini */
export function PendingProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const { isSuper, user } = useAuth();
  // Yangi parol o'rnatilmaguncha server boshqa bo'limlarni yopadi — so'rov yuborilmaydi
  const locked = !!user?.mustChangePassword;
  const [count, setCount] = useState(0);
  const [errorsCount, setErrorsCount] = useState(0);
  const [latestReceiptId, setLatest] = useState<string | null>(null);
  const lastSeen = useRef<bigint | null>(null);

  const refreshErrors = useCallback(() => {
    if (!isSuper || locked) return;
    api
      .get<{ open: number }>("/errors/count")
      .then(({ data }) => setErrorsCount(data.open))
      .catch(() => undefined);
  }, [isSuper, locked]);

  useEffect(() => {
    refreshErrors();
    const t = setInterval(refreshErrors, ERRORS_POLL_MS);
    return () => clearInterval(t);
  }, [refreshErrors]);

  const fetchPending = useCallback(() => {
    if (locked) return;
    api
      .get<{ count: number; latestReceiptId: string | null }>("/orders/pending-count")
      .then(({ data }) => {
        setCount(data.count);
        setLatest(data.latestReceiptId);
        const latest = data.latestReceiptId ? BigInt(data.latestReceiptId) : null;
        // Birinchi yuklashda xabar chiqarilmaydi — faqat keyin kelgan yangi cheklar uchun
        if (latest !== null && lastSeen.current !== null && latest > lastSeen.current) {
          toast.success(`🧾 Yangi chek keldi — tekshirilishi kerak: ${data.count} ta`);
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification("Yangi to'lov cheki", { body: `Tekshirilishi kerak: ${data.count} ta` });
          }
        }
        if (latest !== null && (lastSeen.current === null || latest > lastSeen.current)) lastSeen.current = latest;
        if (lastSeen.current === null) lastSeen.current = 0n;
      })
      .catch(() => undefined);
  }, [toast, locked]);

  const refresh = useCallback(() => {
    fetchPending();
    refreshErrors();
  }, [fetchPending, refreshErrors]);

  useEffect(() => {
    fetchPending();
    const t = setInterval(fetchPending, POLL_MS);
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    return () => clearInterval(t);
  }, [fetchPending]);

  useEffect(() => {
    document.title = count > 0 ? `(${count}) ${BASE_TITLE}` : BASE_TITLE;
  }, [count]);

  const value = useMemo(() => ({ count, errorsCount, latestReceiptId, refresh }), [count, errorsCount, latestReceiptId, refresh]);
  return <PendingContext.Provider value={value}>{children}</PendingContext.Provider>;
}

export function usePending(): PendingValue {
  const ctx = useContext(PendingContext);
  if (!ctx) throw new Error("usePending PendingProvider ichida ishlatilishi kerak");
  return ctx;
}
