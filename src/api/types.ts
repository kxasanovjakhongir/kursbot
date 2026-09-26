import type { SafePanelUser } from "../services/panelUsers";
import type { AppSession } from "./webapp/session";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** requireAuth dan keyin mavjud (admin panel) */
      panelUser?: SafePanelUser;
      /** requireAppUser dan keyin mavjud (Telegram Mini App) */
      appSession?: AppSession;
    }
  }
}
