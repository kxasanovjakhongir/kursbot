import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { backButton } from "../lib/telegram";

/** Ichki sahifalarda Telegram'ning native "Orqaga" tugmasi (sarlavhadagi ←) */
export function useBackButton(fallback = "/"): void {
  const navigate = useNavigate();
  useEffect(() => {
    const bb = backButton();
    if (!bb) return;
    const onBack = () => {
      if (window.history.state && window.history.state.idx > 0) navigate(-1);
      else navigate(fallback, { replace: true });
    };
    bb.onClick(onBack);
    bb.show();
    return () => {
      bb.offClick(onBack);
      bb.hide();
    };
  }, [navigate, fallback]);
}
