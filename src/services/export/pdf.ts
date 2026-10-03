import { once } from "node:events";
import type { Writable } from "node:stream";
import PDFDocument from "pdfkit";
import { formatDate, formatDateTime, formatMoney, truncate } from "../../lib/format";
import { cleanText, summaryLines, type ExportRow, type ExportSource } from "./rows";

/**
 * PDF: albom A4, jadval sahifalarga bo'linadi (har sahifada sarlavha qatori va sahifa raqami).
 * Sahifalar tayyor bo'lishi bilan oqimga yoziladi (bufferPages o'chiq) — katta bazada ham xotira kichik.
 * Shrift — DejaVu Sans: lotin, kirill va o'zbek belgilari (oʻ, gʻ) to'g'ri chiqadi.
 */
const FONT = require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans.ttf");
const FONT_BOLD = require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf");

const MARGIN = 30;
const FONT_SIZE = 7;
const PAD = 3;
/** Juda uzun qiymat (kurslar ro'yxati) qatorni sahifadan baland qilib yubormasligi uchun */
const CELL_MAX = 160;
const YIELD_EVERY = 100;

interface Column {
  header: string;
  width: number;
  align?: "left" | "right";
  value: (r: ExportRow, n: number) => string;
}

// Jami kenglik = 842 - 2×30 = 782 pt
const COLUMNS: Column[] = [
  // 34 pt — olti xonali tartib raqami ham bir qatorga sig'adi (tor ustunda 10 000 dan keyin har qator ikki qavat bo'lib qolardi)
  { header: "№", width: 34, align: "right", value: (_r, n) => String(n) },
  { header: "Telegram ID", width: 62, value: (r) => r.telegramId },
  { header: "Username", width: 70, value: (r) => r.username },
  { header: "Ism Familiya", width: 96, value: (r) => [r.firstName, r.lastName].filter(Boolean).join(" ") },
  { header: "Telefon", width: 70, value: (r) => r.phone },
  { header: "Ro'yxatdan o'tgan", width: 56, value: (r) => formatDate(r.createdAt) },
  { header: "Oxirgi faollik", width: 56, value: (r) => formatDate(r.lastSeenAt) },
  { header: "Sotib olgan kurslari", width: 136, value: (r) => r.courses },
  { header: "Soni", width: 28, align: "right", value: (r) => String(r.purchaseCount) },
  { header: "Summa (so'm)", width: 60, align: "right", value: (r) => formatMoney(r.totalPaid) },
  { header: "To'lov holati", width: 66, value: (r) => r.paymentStatus },
  { header: "Status", width: 48, value: (r) => r.accountStatus },
];

export async function writePdf(source: ExportSource, out: Writable): Promise<void> {
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: MARGIN,
    bufferPages: false,
    // Shrift layout keshi har bir noyob so'zni (ID, telefon, username) abadiy saqlaydi — 80 000 qatorda
    // ~600 MB. O'chirilganda xotira doimiy qoladi, tezlik biroz pasayadi
    fontLayoutCache: false,
    info: { Title: "Foydalanuvchilar ro'yxati", Author: "Darslik bot", CreationDate: source.summary.generatedAt },
  });
  const done = new Promise<void>((resolve, reject) => {
    out.on("finish", resolve);
    out.on("close", resolve);
    out.on("error", reject);
    doc.on("error", reject);
  });
  doc.pipe(out);
  doc.registerFont("regular", FONT);
  doc.registerFont("bold", FONT_BOLD);

  let pageNo = 1;
  const footer = () => {
    // Pastki chekkaga yozish yangi sahifa ochmasligi uchun chegara vaqtincha olib tashlanadi
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font("regular")
      .fontSize(7)
      .fillColor("#666666")
      .text(`Sahifa ${pageNo} · ${formatDateTime(source.summary.generatedAt)}`, MARGIN, doc.page.height - 20, {
        width: doc.page.width - 2 * MARGIN,
        align: "right",
        lineBreak: false,
      });
    doc.page.margins.bottom = bottom;
    doc.fillColor("#000000");
  };

  const cellHeight = (text: string, width: number, bold = false) =>
    doc.font(bold ? "bold" : "regular").fontSize(FONT_SIZE).heightOfString(text, { width: width - 2 * PAD }) + 2 * PAD;

  const rowHeight = (cells: string[], header = false) => Math.max(...cells.map((t, i) => cellHeight(t, COLUMNS[i].width, header)));

  const drawRow = (cells: string[], header: boolean, shade: boolean, h = rowHeight(cells, header)) => {
    const y = doc.y;
    let x = MARGIN;
    if (header || shade) doc.rect(MARGIN, y, doc.page.width - 2 * MARGIN, h).fill(header ? "#1E40AF" : "#F3F4F6");
    cells.forEach((t, i) => {
      const c = COLUMNS[i];
      doc
        .font(header ? "bold" : "regular")
        .fontSize(FONT_SIZE)
        .fillColor(header ? "#FFFFFF" : "#111111")
        .text(t, x + PAD, y + PAD, { width: c.width - 2 * PAD, align: header ? "left" : (c.align ?? "left") });
      x += c.width;
    });
    doc.moveTo(MARGIN, y + h).lineTo(doc.page.width - MARGIN, y + h).lineWidth(0.3).strokeColor("#D1D5DB").stroke();
    doc.x = MARGIN;
    doc.y = y + h;
    return h;
  };

  const headerCells = COLUMNS.map((c) => c.header);
  const pageBottom = () => doc.page.height - MARGIN - 12;

  // Sarlavha va statistika
  doc.font("bold").fontSize(16).fillColor("#1E40AF").text("Foydalanuvchilar ro'yxati");
  doc.moveDown(0.3);
  for (const [k, v] of summaryLines(source.summary)) {
    doc.font("bold").fontSize(9).fillColor("#111111").text(`${k}: `, { continued: true }).font("regular").text(cleanText(v));
  }
  doc.moveDown(0.8);
  drawRow(headerCells, true, false);

  // Bo'laklangan faylda tartib raqami oldingi qismdan davom etadi
  const first = source.summary.part?.from ?? 1;
  let n = 0;
  for await (const rows of source.batches()) {
    for (const r of rows) {
      const cells = COLUMNS.map((c) => truncate(cleanText(c.value(r, first + n)), CELL_MAX));
      const h = rowHeight(cells);
      if (doc.y + h > pageBottom()) {
        footer();
        doc.addPage();
        pageNo++;
        drawRow(headerCells, true, false);
      }
      n++;
      drawRow(cells, false, n % 2 === 0, h);
      // Matn o'lchash sinxron — bot va API so'rovlari kutib qolmasligi uchun event loop'ga navbat beriladi
      if (n % YIELD_EVERY === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    if (out.writableNeedDrain) await once(out, "drain");
  }
  if (n === 0) doc.moveDown().font("regular").fontSize(9).fillColor("#111111").text("Tanlangan filtr bo'yicha foydalanuvchilar topilmadi.");
  footer();
  doc.end();
  await done;
}
