import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { useSession } from "../context/SessionContext";
import { errorText } from "../i18n";
import { haptic } from "../lib/telegram";

// ---------- Tugmalar ----------

type Variant = "primary" | "secondary" | "destructive" | "plain";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-button text-button-text",
  secondary: "bg-button/12 text-accent",
  destructive: "bg-destructive/12 text-destructive",
  plain: "text-accent",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  block?: boolean;
}

/** Telegram uslubidagi tugma. loading/disabled bo'lganda bosilmaydi (dublikat so'rov yo'q) */
export function Button({ variant = "primary", loading, block, className = "", children, disabled, onClick, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      onClick={(e) => {
        haptic.tap();
        onClick?.(e);
      }}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold transition-opacity active:opacity-70 disabled:opacity-50 ${
        block ? "w-full" : ""
      } ${VARIANTS[variant]} ${className}`}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

// ---------- Sahifa va bo'limlar ----------

export function Page({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-24 pt-[calc(var(--tg-content-safe-area-inset-top,0px)+12px)]">
      {title && (
        <header className="mb-3 flex items-center justify-between gap-3 px-1">
          <h1 className="text-[22px] font-bold leading-tight">{title}</h1>
          {action}
        </header>
      )}
      {children}
    </main>
  );
}

/** Telegram sozlamalaridagi kabi guruhlangan blok */
export function Section({ title, footer, children, className = "" }: { title?: string; footer?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`mb-5 ${className}`}>
      {title && <h2 className="mb-1.5 px-4 text-[13px] font-medium uppercase tracking-wide text-subtitle">{title}</h2>}
      <div className="overflow-hidden rounded-2xl bg-section">{children}</div>
      {footer && <p className="mt-1.5 px-4 text-[13px] text-hint">{footer}</p>}
    </section>
  );
}

interface RowProps {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  after?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
}

/** Ro'yxat qatori: ikonka, sarlavha, izoh, o'ng tomonda qiymat/strelka */
export function Row({ icon, title, subtitle, after, onClick, chevron = !!onClick }: RowProps) {
  const content = (
    <>
      {icon && <span className="flex h-9 w-9 shrink-0 items-center justify-center">{icon}</span>}
      <span className="min-w-0 flex-1 border-b border-separator py-3 pr-4 group-last:border-b-0">
        <span className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate text-[16px]">{title}</span>
            {subtitle && <span className="mt-0.5 block text-[14px] leading-snug text-hint">{subtitle}</span>}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-hint">
            {after}
            {chevron && <ChevronRight className="h-4 w-4 opacity-60" />}
          </span>
        </span>
      </span>
    </>
  );
  const cls = "group flex w-full items-center gap-3 pl-4 text-left";
  return onClick ? (
    <button type="button" className={`${cls} active:bg-secondary`} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={cls}>{content}</div>
  );
}

// ---------- Holatlar ----------

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />;
}

/** Ro'yxat yuklanayotganda — haqiqiy qatorlar shaklida */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3 rounded-2xl bg-section p-4" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl bg-section px-6 py-10 text-center">
      {icon && <div className="mb-3 text-hint">{icon}</div>}
      <p className="text-[16px] font-medium">{title}</p>
      {hint && <p className="mt-1 text-[14px] text-hint">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useSession();
  return (
    <div className="flex flex-col items-center rounded-2xl bg-section px-6 py-10 text-center" role="alert">
      <p className="text-[16px] font-medium">{t("error_title")}</p>
      <p className="mt-1 text-[14px] text-hint">{errorText(t, error)}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          {t("retry")}
        </Button>
      )}
    </div>
  );
}

/** Yuklanish → xato → ma'lumot: har bir sahifada bir xil xatti-harakat */
export function Async<T>({
  state,
  skeleton,
  children,
}: {
  state: { data: T | null; loading: boolean; error: unknown; reload: () => void };
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (state.data !== null) return <>{children(state.data)}</>;
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  return <>{skeleton ?? <ListSkeleton />}</>;
}

// ---------- Kichik elementlar ----------

type Tone = "green" | "blue" | "yellow" | "red" | "gray";
const TONES: Record<Tone, string> = {
  green: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  blue: "bg-button/15 text-accent",
  yellow: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  red: "bg-destructive/15 text-destructive",
  gray: "bg-hint/15 text-hint",
};

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-semibold ${TONES[tone]}`}>{children}</span>;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="mb-4 grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-section p-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => {
            haptic.select();
            onChange(o.value);
          }}
          className={`min-w-0 truncate rounded-lg px-1.5 py-1.5 text-[14px] font-medium transition-colors ${o.value === value ? "bg-button text-button-text shadow-sm" : "text-hint"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        haptic.select();
        onChange(!checked);
      }}
      className={`relative h-7 w-12 rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-button" : "bg-hint/40"}`}
    >
      <span className={`absolute left-0 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`} />
    </button>
  );
}

/** Pastdan chiqadigan oyna (mobil uchun modal o'rniga) */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="sheet-in safe-bottom max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-secondary px-4 pt-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-hint/40" />
        {title && <h3 className="mb-3 px-1 text-[18px] font-semibold">{title}</h3>}
        <div className="pb-4">{children}</div>
      </div>
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "accent" | "destructive" }) {
  return (
    <div className="rounded-2xl bg-section p-3.5">
      <p className="text-[13px] text-hint">{label}</p>
      <p className={`mt-1 text-[20px] font-bold tabular-nums ${tone === "accent" ? "text-accent" : tone === "destructive" ? "text-destructive" : ""}`}>{value}</p>
    </div>
  );
}
