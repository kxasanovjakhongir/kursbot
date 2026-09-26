import { Router } from "express";
import { getDashboardStats } from "../../services/stats";

export const dashboardRouter = Router();

dashboardRouter.get("/stats", async (_req, res) => {
  res.json(await getDashboardStats());
});
