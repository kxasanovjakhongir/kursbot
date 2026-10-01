import type { SafePanelUser } from "../services/panelUsers";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** requireAuth dan keyin mavjud (admin panel) */
      panelUser?: SafePanelUser;
    }
  }
}
