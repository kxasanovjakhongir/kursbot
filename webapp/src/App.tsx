import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Ban, Loader2, Send, Wrench } from "lucide-react";
import { SessionProvider, useSession } from "./context/SessionContext";
import { ToastProvider, useToast } from "./context/ToastContext";
import { BottomNav } from "./components/BottomNav";
import { Button, ListSkeleton, Page } from "./components/ui";
import HomePage from "./pages/HomePage";
import ProductPage from "./pages/ProductPage";
import OrderPage from "./pages/OrderPage";
import OrdersPage from "./pages/OrdersPage";
import NotificationsPage from "./pages/NotificationsPage";
import ProfilePage from "./pages/ProfilePage";

// Admin bo'limi oddiy foydalanuvchiga yuklanmaydi (alohida chunk)
const AdminPage = lazy(() => import("./pages/admin/AdminPage"));

function FullScreen({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-8 text-center">
      <div className="mb-4 text-accent">{icon}</div>
      <h1 className="text-[20px] font-bold">{title}</h1>
      {text && <p className="mt-2 max-w-sm text-[15px] text-hint">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const { state, t, retry } = useSession();
  if (state.status === "loading") return <FullScreen icon={<Loader2 className="h-8 w-8 animate-spin" />} title={t("loading")} />;
  if (state.status === "outside") return <FullScreen icon={<Send className="h-10 w-10" />} title={t("outside_title")} text={t("outside_text")} />;
  if (state.status === "error") {
    const retryBtn = <Button onClick={retry}>{t("retry")}</Button>;
    if (state.reason === "banned") return <FullScreen icon={<Ban className="h-10 w-10" />} title={t("banned_title")} text={t("banned_text")} />;
    if (state.reason === "maintenance") return <FullScreen icon={<Wrench className="h-10 w-10" />} title={t("maintenance_title")} text={t("maintenance_text")} action={retryBtn} />;
    return <FullScreen icon={<Send className="h-10 w-10" />} title={t("error_title")} text={t(state.reason === "network" ? "error_network" : "auth_failed")} action={retryBtn} />;
  }
  return <>{children}</>;
}

/**
 * Reklama linki (startapp=<kod>) bilan ochilganda — to'g'ridan-to'g'ri o'sha darslik sahifasi.
 * Havola noto'g'ri/eskirgan bo'lsa — xabar va umumiy katalog. Linksiz ochilsa — oddiy asosiy sahifa.
 */
function EntryRedirect() {
  const { state, takeEntry, t } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  useEffect(() => {
    if (state.status !== "ready") return;
    const entry = takeEntry();
    if (!entry) return;
    if (entry.status === "unavailable") toast.error(t("link_unavailable"));
    // Bot tugmasi allaqachon aniq sahifani ochgan bo'lsa (masalan /product/4b), uni almashtirmaymiz
    else if (location.pathname === "/") navigate(`/product/${encodeURIComponent(entry.productCode)}`, { replace: true });
  }, [state.status, takeEntry, navigate, location.pathname, toast, t]);
  return null;
}

function AdminRoute() {
  const { can } = useSession();
  if (!can("orders.review")) return <Navigate to="/" replace />;
  return (
    <Suspense
      fallback={
        <Page>
          <ListSkeleton />
        </Page>
      }
    >
      <AdminPage />
    </Suspense>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <ToastProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Gate>
            <EntryRedirect />
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/product/:code" element={<ProductPage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/orders/:id" element={<OrderPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/admin" element={<AdminRoute />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            <BottomNav />
          </Gate>
        </BrowserRouter>
      </ToastProvider>
    </SessionProvider>
  );
}
