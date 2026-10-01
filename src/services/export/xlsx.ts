import { once } from "node:events";
import type { Writable } from "node:stream";
import ExcelJS from "exceljs";
import { cleanText, summaryLines, tashkentWallClock, type ExportRow, type ExportSource } from "./rows";

type Kind = "text" | "date" | "number" | "money";

interface Column {
  header: string;
  key: keyof ExportRow;
  kind: Kind;
  max: number;
}

/** Excel'da barcha maydonlar (to'liq jadval) */
const COLUMNS: Column[] = [
  { header: "User ID", key: "id", kind: "text", max: 12 },
  { header: "Telegram ID", key: "telegramId", kind: "text", max: 16 },
  { header: "Username", key: "username", kind: "text", max: 28 },
  { header: "Ism", key: "firstName", kind: "text", max: 28 },
  { header: "Familiya", key: "lastName", kind: "text", max: 28 },
  { header: "Telefon", key: "phone", kind: "text", max: 18 },
  { header: "Botga kirgan sana", key: "createdAt", kind: "date", max: 18 },
  { header: "Ro'yxatdan o'tgan (telefon)", key: "registeredAt", kind: "date", max: 18 },
  { header: "Oxirgi faollik", key: "lastSeenAt", kind: "date", max: 18 },
  { header: "Sotib olgan kurslari", key: "courses", kind: "text", max: 50 },
  { header: "Sotib olishlar soni", key: "purchaseCount", kind: "number", max: 12 },
  { header: "Umumiy xarid summasi (so'm)", key: "totalPaid", kind: "money", max: 16 },
  { header: "To'lov holati (oxirgi buyurtma)", key: "paymentStatus", kind: "text", max: 24 },
  { header: "Kurs sotib olingan sana", key: "purchaseDates", kind: "text", max: 60 },
  { header: "Account status", key: "accountStatus", kind: "text", max: 18 },
  { header: "Til", key: "language", kind: "text", max: 8 },
  { header: "Manba", key: "source", kind: "text", max: 20 },
];

const DATE_FMT = "dd.mm.yyyy hh:mm";

function cellValue(row: ExportRow, c: Column): string | number | Date | null {
  const v = row[c.key];
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return tashkentWallClock(v);
  return typeof v === "string" ? cleanText(v) : v;
}

/** Ustun kengligi: sarlavha va birinchi bo'lak ma'lumotlari bo'yicha (stream rejimida keyin o'zgartirib bo'lmaydi) */
function widths(sample: ExportRow[]): number[] {
  return COLUMNS.map((c) => {
    let w = c.header.length;
    if (c.kind === "date") w = Math.max(w, 16);
    for (const r of sample) {
      const v = r[c.key];
      const len = v instanceof Date ? 16 : String(v ?? "").length;
      if (len > w) w = len;
    }
    return Math.min(Math.max(w + 2, 8), Math.max(c.max, c.header.length + 2));
  });
}

/**
 * Stream rejimidagi Excel: har bir qator yozilishi bilan "commit" qilinadi va xotiradan chiqadi,
 * fayl to'g'ridan-to'g'ri javob oqimiga (HTTP yoki Telegram) yoziladi.
 */
export async function writeXlsx(source: ExportSource, out: Writable): Promise<void> {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false });
  wb.creator = "Darslik bot";
  wb.created = source.summary.generatedAt;

  const ws = wb.addWorksheet("Foydalanuvchilar", { views: [{ state: "frozen", ySplit: 1 }] });
  const iterator = source.batches();
  const first = await iterator.next();
  const firstBatch = first.done ? [] : first.value;
  const w = widths(firstBatch);

  ws.columns = COLUMNS.map((c, i) => ({
    header: c.header,
    key: c.key,
    width: w[i],
    style: c.kind === "date" ? { numFmt: DATE_FMT } : c.kind === "money" ? { numFmt: "#,##0" } : {},
  }));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E40AF" } };
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 30;
  header.commit();

  const writeBatch = async (rows: ExportRow[]) => {
    for (const r of rows) ws.addRow(COLUMNS.map((c) => cellValue(r, c))).commit();
    // Qabul qiluvchi sekin bo'lsa (sekin internet) — bufer to'lib ketmasligi uchun kutamiz
    if (out.writableNeedDrain) await once(out, "drain");
  };

  await writeBatch(firstBatch);
  if (!first.done) for await (const rows of iterator) await writeBatch(rows);
  ws.commit();

  const stats = wb.addWorksheet("Statistika");
  stats.columns = [
    { header: "Ko'rsatkich", key: "k", width: 28 },
    { header: "Qiymat", key: "v", width: 70 },
  ];
  stats.getRow(1).font = { bold: true };
  stats.getRow(1).commit();
  for (const [k, v] of summaryLines(source.summary)) stats.addRow([k, cleanText(v)]).commit();
  stats.commit();

  await wb.commit();
}
