import { useSession } from "../context/SessionContext";
import { fmtNumber } from "../lib/format";

export function Money({ amount, className = "" }: { amount: number; className?: string }) {
  const { t } = useSession();
  return (
    <span className={`tabular-nums ${className}`}>
      {fmtNumber(amount)} {t("sum")}
    </span>
  );
}
