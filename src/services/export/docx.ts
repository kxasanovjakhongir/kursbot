import { Readable, type Writable } from "node:stream";
import archiver from "archiver";
import { formatDateTime, formatMoney } from "../../lib/format";
import { cleanText, summaryLines, type ExportRow, type ExportSource } from "./rows";

/**
 * Word (.docx) — OOXML qo'lda, oqim bilan: document.xml jadval qatorlari bo'lak-bo'lak hosil qilinadi
 * va zip'ga to'g'ridan-to'g'ri yoziladi (butun hujjat xotirada yig'ilmaydi). Albom (landscape) A4,
 * sarlavha qatori har sahifada takrorlanadi, sahifa raqami pastda.
 */

interface Column {
  header: string;
  /** Kenglik — twip (1/1440 dyuym). Albom A4 ish maydoni ≈ 15398 */
  width: number;
  value: (r: ExportRow, n: number) => string;
}

const COLUMNS: Column[] = [
  { header: "№", width: 500, value: (_r, n) => String(n) },
  { header: "User ID", width: 800, value: (r) => r.id },
  { header: "Telegram ID", width: 1250, value: (r) => r.telegramId },
  { header: "Username", width: 1350, value: (r) => r.username },
  { header: "Ism Familiya", width: 1700, value: (r) => [r.firstName, r.lastName].filter(Boolean).join(" ") },
  { header: "Telefon", width: 1300, value: (r) => r.phone },
  { header: "Ro'yxatdan o'tgan", width: 1150, value: (r) => formatDateTime(r.createdAt) },
  { header: "Oxirgi faollik", width: 1150, value: (r) => formatDateTime(r.lastSeenAt) },
  { header: "Sotib olgan kurslari", width: 2150, value: (r) => r.courses },
  { header: "Soni", width: 550, value: (r) => String(r.purchaseCount) },
  { header: "Summa (so'm)", width: 1150, value: (r) => (r.totalPaid ? formatMoney(r.totalPaid) : "0") },
  { header: "To'lov holati", width: 1250, value: (r) => r.paymentStatus },
  { header: "Status", width: 1048, value: (r) => r.accountStatus },
];

const esc = (s: string) => cleanText(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const run = (text: string, opts: { bold?: boolean; size?: number; color?: string } = {}) =>
  `<w:r><w:rPr>${opts.bold ? "<w:b/>" : ""}${opts.color ? `<w:color w:val="${opts.color}"/>` : ""}${opts.size ? `<w:sz w:val="${opts.size}"/><w:szCs w:val="${opts.size}"/>` : ""}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;

const para = (content: string, style?: string, spacingAfter = 80) =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}<w:spacing w:after="${spacingAfter}"/></w:pPr>${content}</w:p>`;

function cell(text: string, width: number, header = false): string {
  const shade = header ? '<w:shd w:val="clear" w:color="auto" w:fill="1E40AF"/>' : "";
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade}</w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${run(text, header ? { bold: true, size: 16, color: "FFFFFF" } : { size: 16 })}</w:p></w:tc>`;
}

function row(cells: string[], header = false): string {
  const trPr = header ? "<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>" : "<w:trPr><w:cantSplit/></w:trPr>";
  return `<w:tr>${trPr}${cells.map((c, i) => cell(c, COLUMNS[i].width, header)).join("")}</w:tr>`;
}

const BORDER = '<w:top w:val="single" w:sz="4" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:color="BFBFBF"/>';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

async function* documentXml(source: ExportSource): AsyncGenerator<string> {
  const { summary } = source;
  yield `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>`;
  yield para(run("Foydalanuvchilar ro'yxati"), "Title", 120);
  yield para(run(`Eksport sanasi: ${formatDateTime(summary.generatedAt)} (Toshkent vaqti)`, { color: "555555" }), undefined, 200);
  yield para(run("Umumiy statistika"), "Heading1");
  for (const [k, v] of summaryLines(summary).slice(1)) yield para(`${run(`${k}: `, { bold: true })}${run(v)}`, undefined, 40);
  yield para(run("Foydalanuvchilar"), "Heading1");

  const grid = COLUMNS.map((c) => `<w:gridCol w:w="${c.width}"/>`).join("");
  yield `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/><w:tblBorders>${BORDER}</w:tblBorders><w:tblCellMar><w:left w:w="60" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>`;
  yield row(COLUMNS.map((c) => c.header), true);
  // Bo'laklangan faylda tartib raqami oldingi qismdan davom etadi
  const offset = (source.summary.part?.from ?? 1) - 1;
  let n = 0;
  for await (const rows of source.batches()) {
    // Bir bo'lak — bitta satr (zip oqimiga yoziladi, keyin xotiradan chiqadi)
    yield rows
      .map((r) => {
        const num = offset + ++n;
        return row(COLUMNS.map((c) => c.value(r, num)));
      })
      .join("");
  }
  yield "</w:tbl>";
  if (n === 0) yield para(run("Tanlangan filtr bo'yicha foydalanuvchilar topilmadi."));
  // Albom A4, chekkalar 0.5 dyuym, pastda sahifa raqami (footer1.xml)
  yield `<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="uz-Latn-UZ"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:color w:val="1E40AF"/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1E40AF"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style></w:styles>`;

const FOOTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">Sahifa </w:t></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve"> / </w:t></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;

const core = (date: Date) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Foydalanuvchilar ro'yxati</dc:title><dc:creator>Darslik bot</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${date.toISOString()}</dcterms:created></cp:coreProperties>`;

export async function writeDocx(source: ExportSource, out: Writable): Promise<void> {
  const zip = archiver("zip", { zlib: { level: 6 } });
  const done = new Promise<void>((resolve, reject) => {
    out.on("finish", resolve);
    out.on("close", resolve);
    out.on("error", reject);
    zip.on("error", reject);
  });
  zip.pipe(out);
  zip.append(CONTENT_TYPES, { name: "[Content_Types].xml" });
  zip.append(ROOT_RELS, { name: "_rels/.rels" });
  zip.append(core(source.summary.generatedAt), { name: "docProps/core.xml" });
  zip.append(STYLES, { name: "word/styles.xml" });
  zip.append(FOOTER, { name: "word/footer1.xml" });
  zip.append(DOC_RELS, { name: "word/_rels/document.xml.rels" });
  // Readable.from — generator iste'molchi tezligida chaqiriladi (backpressure)
  zip.append(Readable.from(documentXml(source)), { name: "word/document.xml" });
  await zip.finalize();
  await done;
}
