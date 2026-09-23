import type { Request } from "express";
import { z, type ZodTypeAny } from "zod";
import { HttpError } from "./errors";

export const parseBody = <S extends ZodTypeAny>(schema: S, req: Request): z.infer<S> => schema.parse(req.body);
export const parseQuery = <S extends ZodTypeAny>(schema: S, req: Request): z.infer<S> => schema.parse(req.query);

export function parseId(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "ID noto'g'ri");
  return id;
}

export function parseBigId(raw: string | undefined): bigint {
  if (!raw || !/^\d{1,19}$/.test(raw)) throw new HttpError(400, "ID noto'g'ri");
  return BigInt(raw);
}

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function paged<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export function clientIp(req: Request): string | null {
  return req.ip ?? null;
}
