import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { haptic } from "../lib/telegram";

type Tone = "success" | "error";
interface ToastValue {
  success: (text: string) => void;
  error: (text: string) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

/** Qisqa bildirishnoma (yuqorida, 2.5 s) + Telegram haptic */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ text: string; tone: Tone; id: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((text: string, tone: Tone) => {
    if (tone === "success") haptic.success();
    else haptic.error();
    window.clearTimeout(timer.current);
    setToast({ text, tone, id: Date.now() });
    timer.current = window.setTimeout(() => setToast(null), 2500);
  }, []);

  const value = useMemo(() => ({ success: (t: string) => show(t, "success"), error: (t: string) => show(t, "error") }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-[calc(var(--tg-content-safe-area-inset-top,0px)+12px)]">
          <div
            key={toast.id}
            role="status"
            className={`toast-in max-w-sm rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg ${
              toast.tone === "success" ? "bg-text text-bg" : "bg-destructive text-white"
            }`}
          >
            {toast.text}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast ToastProvider ichida ishlatilishi kerak");
  return ctx;
}
