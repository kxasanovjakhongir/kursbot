import { NavLink } from "react-router-dom";
import { Bell, House, Receipt, ShieldCheck, UserRound, type LucideIcon } from "lucide-react";
import { useSession } from "../context/SessionContext";
import type { MessageKey } from "../i18n";
import { haptic } from "../lib/telegram";

interface Tab {
  to: string;
  label: MessageKey;
  icon: LucideIcon;
}

const TABS: Tab[] = [
  { to: "/", label: "tab_home", icon: House },
  { to: "/orders", label: "tab_orders", icon: Receipt },
  { to: "/notifications", label: "tab_notifications", icon: Bell },
  { to: "/profile", label: "tab_profile", icon: UserRound },
];

/** Pastki navigatsiya. Admin tabi faqat cheklarni tekshirish huquqi borlarga */
export function BottomNav() {
  const { t, can } = useSession();
  const tabs = can("orders.review") ? [...TABS, { to: "/admin", label: "tab_admin" as const, icon: ShieldCheck }] : TABS;
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-separator bg-bg/95 backdrop-blur">
      <div className="mx-auto grid max-w-xl" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            onClick={() => haptic.select()}
            className={({ isActive }) => `flex flex-col items-center gap-0.5 pb-1.5 pt-2 text-[11px] font-medium ${isActive ? "text-accent" : "text-hint"}`}
          >
            <Icon className="h-6 w-6" strokeWidth={1.8} />
            {t(label)}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
