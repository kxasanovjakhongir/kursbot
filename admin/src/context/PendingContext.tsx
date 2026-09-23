import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { useToast } from "./ToastContext";

interface PendingValue {
  count: number;
  latestReceiptId: string | null;
  refresh: () => void;
}

const PendingContext = createContext<PendingValue | null>(null);
const POLL_MS = 10_000;
const BASE_TITLE = "Bot Admin Panel";

/** Yangi cheklarni kuzatadi: menyudagi son, toast va brauzer bildirishnomasi */
export function PendingProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [count, setCount] = useState(0);
  const [latestReceiptId, setLatest] = useState<string | null>(null);
  const lastSeen = useRef<bigint | null>(null);

  const refresh = useCallback(() => {
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
  }, [toast]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    document.title = count > 0 ? `(${count}) ${BASE_TITLE}` : BASE_TITLE;
  }, [count]);

  const value = useMemo(() => ({ count, latestReceiptId, refresh }), [count, latestReceiptId, refresh]);
  return <PendingContext.Provider value={value}>{children}</PendingContext.Provider>;
}

export function usePending(): PendingValue {
  const ctx = useContext(PendingContext);
  if (!ctx) throw new Error("usePending PendingProvider ichida ishlatilishi kerak");
  return ctx;
}
