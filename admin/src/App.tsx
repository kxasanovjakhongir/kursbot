import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import { PendingProvider } from "./context/PendingContext";
import { Layout } from "./components/Layout";
import { RequireAuth, RequireSuper } from "./components/guards";
import LoginPage from "./pages/LoginPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import DashboardPage from "./pages/DashboardPage";
import TelegramUsersPage from "./pages/TelegramUsersPage";
import TelegramUserDetailPage from "./pages/TelegramUserDetailPage";
import MessagesPage from "./pages/MessagesPage";
import OrdersPage from "./pages/OrdersPage";
import OrderDetailPage from "./pages/OrderDetailPage";
import BroadcastPage from "./pages/BroadcastPage";
import BroadcastHistoryPage from "./pages/BroadcastHistoryPage";
import BroadcastDetailPage from "./pages/BroadcastDetailPage";
import BotCommandsPage from "./pages/BotCommandsPage";
import BotMenuPage from "./pages/BotMenuPage";
import AdminsPage from "./pages/AdminsPage";
import ActivityLogsPage from "./pages/ActivityLogsPage";
import BotSettingsPage from "./pages/BotSettingsPage";
import BotTextsPage from "./pages/BotTextsPage";
import BotButtonsPage from "./pages/BotButtonsPage";
import ProfilePage from "./pages/ProfilePage";
import NotFoundPage from "./pages/NotFoundPage";
import ReceiptsPage from "./pages/ReceiptsPage";
import LinksPage from "./pages/LinksPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import ProductsPage from "./pages/ProductsPage";
import CardsPage from "./pages/CardsPage";
import ErrorsPage from "./pages/ErrorsPage";
import LessonsPage from "./pages/LessonsPage";

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route
              element={
                <RequireAuth>
                  <PendingProvider>
                    <Layout />
                  </PendingProvider>
                </RequireAuth>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="telegram-users" element={<TelegramUsersPage />} />
              <Route path="telegram-users/:id" element={<TelegramUserDetailPage />} />
              <Route path="messages" element={<MessagesPage />} />
              <Route path="receipts" element={<ReceiptsPage />} />
              <Route path="products" element={<RequireSuper><ProductsPage /></RequireSuper>} />
              <Route path="lessons" element={<LessonsPage />} />
              <Route path="cards" element={<RequireSuper><CardsPage /></RequireSuper>} />
              <Route path="links" element={<LinksPage />} />
              <Route path="orders" element={<OrdersPage />} />
              <Route path="orders/:id" element={<OrderDetailPage />} />
              <Route path="broadcast" element={<BroadcastPage />} />
              <Route path="broadcast/history" element={<BroadcastHistoryPage />} />
              <Route path="broadcast/:id" element={<BroadcastDetailPage />} />
              <Route path="bot/commands" element={<BotCommandsPage />} />
              <Route path="bot/menu" element={<BotMenuPage />} />
              <Route path="admins" element={<RequireSuper><AdminsPage /></RequireSuper>} />
              <Route path="activity-logs" element={<RequireSuper><ActivityLogsPage /></RequireSuper>} />
              <Route path="errors" element={<RequireSuper><ErrorsPage /></RequireSuper>} />
              <Route path="bot/settings" element={<RequireSuper><BotSettingsPage /></RequireSuper>} />
              <Route path="bot/texts" element={<RequireSuper><BotTextsPage /></RequireSuper>} />
              <Route path="bot/buttons" element={<RequireSuper><BotButtonsPage /></RequireSuper>} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
