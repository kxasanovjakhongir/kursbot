import { Router } from "express";
import { z } from "zod";
import { courseStats, overview, segmentStats } from "../../services/analytics";
import { HttpError } from "../errors";
import { parseQuery } from "../validate";

const MAX_RANGE_DAYS = 366;

const rangeQuery = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
});

/** Marketing analitikasi: davr [from, to) — frontend Toshkent vaqti bo'yicha hisoblab yuboradi */
export const analyticsRouter = Router();

analyticsRouter.get("/", async (req, res) => {
  const { from, to } = parseQuery(rangeQuery, req);
  if (to <= from) throw new HttpError(400, "Davr noto'g'ri: «gacha» sanasi «dan» sanasidan keyin bo'lishi kerak");
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86400_000) throw new HttpError(400, `Davr ${MAX_RANGE_DAYS} kundan oshmasligi kerak`);
  const range = { from, to };
  const [summary, courses, sources, campaigns] = await Promise.all([
    overview(range),
    courseStats(range),
    segmentStats(range, false),
    segmentStats(range, true),
  ]);
  res.json({ ...summary, courses, sources, campaigns });
});
