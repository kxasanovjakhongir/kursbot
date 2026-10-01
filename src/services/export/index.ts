import type { Writable } from "node:stream";
import type { UserFilter } from "../users";
import { userExportSource, type ExportSummary } from "./rows";
import { writeDocx } from "./docx";
import { writePdf } from "./pdf";
import { writeXlsx } from "./xlsx";

export const EXPORT_FORMATS = ["xlsx", "docx", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_MIME: Record<ExportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

const WRITERS = { xlsx: writeXlsx, docx: writeDocx, pdf: writePdf } as const;

/** users-2026-10-01-1530.xlsx (Toshkent vaqti) */
export function exportFileName(format: ExportFormat, at = new Date()): string {
  const t = new Date(at.getTime() + 5 * 3600_000).toISOString();
  return `users-${t.slice(0, 10)}-${t.slice(11, 13)}${t.slice(14, 16)}.${format}`;
}

/**
 * Ikki bosqich: avval statistika hisoblanadi (xato bo'lsa — hali hech narsa yuborilmagan, oddiy xato
 * javobi qaytarish mumkin), keyin `write` fayl tanasini oqimga yozadi.
 */
export async function prepareUserExport(format: ExportFormat, filter: UserFilter): Promise<{ summary: ExportSummary; write: (out: Writable) => Promise<void> }> {
  const source = await userExportSource(filter);
  return { summary: source.summary, write: (out) => WRITERS[format](source, out) };
}
