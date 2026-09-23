import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Spinner } from "./ui";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export function RequireSuper({ children }: { children: ReactNode }) {
  const { isSuper } = useAuth();
  if (!isSuper) return <Navigate to="/" replace />;
  return <>{children}</>;
}
