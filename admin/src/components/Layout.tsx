import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  BarChart3,
  Bot,
  ChevronsLeft,
  ChevronsRight,
  CreditCard,
  Package,
  Receipt,
  History,
  LayoutDashboard,
  Link2,
  ListOrdered,
  LogOut,
  Menu as MenuIcon,
  MessageSquare,
  Megaphone,
  ScrollText,
  Settings,
  ShieldCheck,
  ShieldAlert,
  ShoppingCart,
  SquareTerminal,
  UserCircle,
  Users,
  X,
  Clapperboard,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { usePending } from "../context/PendingContext";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  superOnly?: boolean;
  badge?: "pending" | "errors";
}

// Ruxsati yo'q bo'limlar menyuda ko'rinmaydi (backend ham alohida tekshiradi)
const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/analytics", label: "Analitika", icon: BarChart3 },
  { to: "/telegram-users", label: "Telegram foydalanuvchilar", icon: Users },
  { to: "/receipts", label: "Cheklar", icon: Receipt, badge: "pending" },
  { to: "/orders", label: "Buyurtmalar", icon: ShoppingCart },
  { to: "/products", label: "Mahsulotlar", icon: Package, superOnly: true },
  { to: "/lessons", label: "Darslar (videolar)", icon: Clapperboard },
  { to: "/links", label: "Kampaniya linklari", icon: Link2 },
  { to: "/cards", label: "To'lov kartalari", icon: CreditCard, superOnly: true },
  { to: "/messages", label: "Xabarlar", icon: MessageSquare },
  { to: "/broadcast", label: "Broadcast", icon: Megaphone },
  { to: "/broadcast/history", label: "Broadcast tarixi", icon: History },
  { to: "/bot/commands", label: "Bot buyruqlari", icon: SquareTerminal },
  { to: "/bot/menu", label: "Bot menyusi", icon: ListOrdered },
  { to: "/admins", label: "Adminlar", icon: ShieldCheck, superOnly: true },
  { to: "/activity-logs", label: "Faoliyat loglari", icon: ScrollText, superOnly: true },
  { to: "/errors", label: "Xatoliklar", icon: ShieldAlert, superOnly: true, badge: "errors" },
  { to: "/bot/settings", label: "Bot sozlamalari", icon: Settings, superOnly: true },
  { to: "/profile", label: "Profil", icon: UserCircle },
];

function NavList({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { isSuper, logout } = useAuth();
  const { count: pendingCount, errorsCount } = usePending();
  const items = NAV.filter((i) => !i.superOnly || isSuper);
  const cls = ({ isActive }: { isActive: boolean }) =>
    `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      isActive ? "bg-sidebar-active text-white" : "text-blue-100/80 hover:bg-sidebar-hover hover:text-white"
    } ${collapsed ? "justify-center" : ""}`;
  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
      {items.map((i) => {
        const count = i.badge === "errors" ? errorsCount : i.badge === "pending" ? pendingCount : 0;
        return (
          <NavLink key={i.to} to={i.to} end={i.to === "/" || i.to === "/broadcast"} className={cls} onClick={onNavigate} title={collapsed ? i.label : undefined}>
            <span className="relative">
              <i.icon className="h-5 w-5 shrink-0" />
              {i.badge && count > 0 && collapsed && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500" />}
            </span>
            {!collapsed && <span className="flex-1 truncate">{i.label}</span>}
            {!collapsed && i.badge && count > 0 && (
              <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-semibold tabular-nums text-white">{count}</span>
            )}
          </NavLink>
        );
      })}
      <button
        onClick={() => void logout()}
        className={`mt-auto flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-blue-100/80 hover:bg-sidebar-hover hover:text-white ${collapsed ? "justify-center" : ""}`}
        title={collapsed ? "Chiqish" : undefined}
      >
        <LogOut className="h-5 w-5 shrink-0" />
        {!collapsed && "Chiqish"}
      </button>
    </nav>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={`flex h-16 items-center gap-2.5 border-b border-white/10 px-5 ${collapsed ? "justify-center px-0" : ""}`}>
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
        <Bot className="h-5 w-5 text-white" />
      </div>
      {!collapsed && <span className="font-semibold text-white">Bot Admin</span>}
    </div>
  );
}

export function Layout() {
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="flex h-full">
      {/* Desktop / planshet: yig'iladigan sidebar */}
      <aside className={`hidden shrink-0 flex-col bg-sidebar transition-[width] md:flex ${collapsed ? "w-[72px]" : "w-64"}`}>
        <Brand collapsed={collapsed} />
        <NavList collapsed={collapsed} />
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex h-11 items-center justify-center border-t border-white/10 text-blue-100/70 hover:text-white"
          aria-label={collapsed ? "Menyuni ochish" : "Menyuni yig'ish"}
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </aside>

      {/* Mobil: hamburger */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-gray-900/60" onClick={() => setMobileOpen(false)} />
          <aside className="relative flex h-full w-72 max-w-[85%] flex-col bg-sidebar">
            <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-4 text-blue-100/80" aria-label="Yopish">
              <X className="h-6 w-6" />
            </button>
            <Brand collapsed={false} />
            <NavList collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 sm:px-6">
          <button className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 md:hidden" onClick={() => setMobileOpen(true)} aria-label="Menyu">
            <MenuIcon className="h-5 w-5" />
          </button>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="text-sm font-medium text-gray-900">{user?.name}</div>
              <div className="text-xs text-gray-500">{user?.role === "superadmin" ? "Super Admin" : "Admin"}</div>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
              {user?.name.slice(0, 1).toUpperCase()}
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
