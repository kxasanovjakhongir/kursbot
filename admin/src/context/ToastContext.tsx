import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";

type ToastKind = "success" | "error";
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastValue {
  success: (text: string) => void;
  error: (text: string) => void;
}

const ToastContext = createContext<ToastValue | null>(null);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (kind: ToastKind, text: string) => {
      const id = ++seq;
      setToasts((t) => [...t.slice(-3), { id, kind, text }]);
      setTimeout(() => remove(id), kind === "error" ? 6000 : 3500);
    },
    [remove],
  );

  const value = useMemo<ToastValue>(() => ({ success: (t) => push("success", t), error: (t) => push("error", t) }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:items-end">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border bg-white px-4 py-3 text-sm shadow-lg ${
              t.kind === "success" ? "border-green-200" : "border-red-200"
            }`}
          >
            {t.kind === "success" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            )}
            <span className="flex-1 text-gray-800">{t.text}</span>
            <button onClick={() => remove(t.id)} className="text-gray-400 hover:text-gray-600" aria-label="Yopish">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast ToastProvider ichida ishlatilishi kerak");
  return ctx;
}
