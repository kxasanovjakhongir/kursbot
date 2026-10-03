import type { Writable } from "node:stream";
import type { UserFilter } from "../users";
import { exportPart, userExportSource, type ExportSummary } from "./rows";
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

/** users-2026-10-01-1530.xlsx (Toshkent vaqti); bo'laklangan bo'lsa — users-2026-10-01-1530-2qism.xlsx */
export function exportFileName(format: ExportFormat, at = new Date(), part?: number): string {
  const t = new Date(at.getTime() + 5 * 3600_000).toISOString();
  return `users-${t.slice(0, 10)}-${t.slice(11, 13)}${t.slice(14, 16)}${part ? `-${part}qism` : ""}.${format}`;
}

export interface ExportPart {
  /** 1 dan boshlab */
  index: number;
  of: number;
}

/**
 * Ikki bosqich: avval statistika hisoblanadi (xato bo'lsa — hali hech narsa yuborilmagan, oddiy xato
 * javobi qaytarish mumkin), keyin `write` fayl tanasini oqimga yozadi. `part` — ro'yxatning faqat shu qismi.
 */
export async function prepareUserExport(
  format: ExportFormat,
  filter: UserFilter,
  part?: ExportPart,
): Promise<{ summary: ExportSummary; write: (out: Writable) => Promise<void> }> {
  const full = await userExportSource(filter);
  const source = part ? exportPart(full, part.index, part.of) : full;
  return { summary: source.summary, write: (out) => WRITERS[format](source, out) };
}
