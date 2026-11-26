// ---------------------------------------------------------------------------
// xlsx.ts — a minimal .xlsx writer for the AI Connector's export_excel
// (routes/mcp.ts). Owner 2026-11-26, AI Connector round 3.
//
// No dependency: an .xlsx is a zip of a few XML files. One sheet, a bold frozen
// header row, column widths from the content, numbers as numbers, money with two
// decimals (RM, never sen). Strings are written inline (no shared-strings table),
// which every reader (Excel, Numbers, LibreOffice, Google Sheets) opens.
// The zip is deflated with the runtime's CompressionStream("deflate-raw")
// (Workers and Node 18+), falling back to stored entries without it.
//
// Pure (Web APIs only, no imports), so `node --test` loads it directly
// (backend/test/mcp-round3.test.mjs).
// ---------------------------------------------------------------------------

export type XlsxColumn = {
  key: string;
  header: string;
  /** text (default) | number | money (RM, 2 decimals) | date (ISO → Malaysia "YYYY-MM-DD HH:mm") */
  kind?: "text" | "number" | "money" | "date";
  width?: number;
};

type Row = Record<string, unknown>;

// ── XML ─────────────────────────────────────────────────────────────────────

// XML 1.0 forbids most control characters; a stray one makes Excel refuse the file.
// eslint-disable-next-line no-control-regex
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function xmlEscape(v: string): string {
  return v.replace(BAD_XML, "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

/** Column letters for a 0-based index: 0 → A, 25 → Z, 26 → AA. */
export function colName(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** An ISO timestamp as Malaysia time "YYYY-MM-DD HH:mm"; anything else unchanged. */
export function myDateTime(v: unknown): string {
  const raw = v instanceof Date ? v.toISOString() : String(v ?? "");
  if (!raw) return "";
  const t = Date.parse(raw);
  if (!Number.isFinite(t) || !/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw; // a plain date stays a date
  return new Date(t + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
}

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(cellText).filter(Boolean).join(", ");
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

// Style ids in styles.xml below: 0 normal, 1 bold header, 2 money #,##0.00, 3 integer/decimal general.
function cellXml(ref: string, v: unknown, kind: XlsxColumn["kind"]): string {
  if (v === null || v === undefined || v === "") return "";
  if (kind === "number" || kind === "money") {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) return `<c r="${ref}"${kind === "money" ? ' s="2"' : ""}><v>${kind === "money" ? Math.round(n * 100) / 100 : n}</v></c>`;
  }
  const text = kind === "date" ? myDateTime(v) : cellText(v);
  if (!text) return "";
  // Excel's cell limit is 32,767 characters.
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text.slice(0, 32_000))}</t></is></c>`;
}

/** Width in characters: header or the longest of the first 300 values, 8..60. */
export function autoWidth(col: XlsxColumn, rows: Row[]): number {
  if (col.width) return col.width;
  let w = col.header.length;
  for (const r of rows.slice(0, 300)) {
    const v = r[col.key];
    const len = col.kind === "money" ? cellText(v).length + 4 : col.kind === "date" ? 16 : cellText(v).length;
    if (len > w) w = len;
  }
  return Math.max(8, Math.min(60, w + 2));
}

export function sheetXml(columns: XlsxColumn[], rows: Row[]): string {
  const cols = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${autoWidth(c, rows)}" customWidth="1"/>`).join("");
  const head = `<row r="1">${columns.map((c, i) => `<c r="${colName(i)}1" t="inlineStr" s="1"><is><t>${xmlEscape(c.header)}</t></is></c>`).join("")}</row>`;
  const body: string[] = [];
  rows.forEach((r, ri) => {
    const n = ri + 2;
    body.push(`<row r="${n}">${columns.map((c, ci) => cellXml(`${colName(ci)}${n}`, r[c.key], c.kind)).join("")}</row>`);
  });
  const last = `${colName(Math.max(0, columns.length - 1))}${rows.length + 1}`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="A1:${last}"/>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${head}${body.join("")}</sheetData>` +
    `</worksheet>`
  );
}

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="4">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

function workbookFiles(sheetName: string, sheet: string): { name: string; data: string }[] {
  const safe = xmlEscape(sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1");
  return [
    {
      name: "[Content_Types].xml",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`,
    },
    {
      name: "_rels/.rels",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${safe}" sheetId="1" r:id="rId1"/></sheets>` +
        `</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    },
    { name: "xl/worksheets/sheet1.xml", data: sheet },
    { name: "xl/styles.xml", data: STYLES },
  ];
}

// ── zip ─────────────────────────────────────────────────────────────────────

let CRC_TABLE: Uint32Array | null = null;
export function crc32(data: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const cs = new CompressionStream("deflate-raw");
    const out = new Response(new Blob([data]).stream().pipeThrough(cs));
    return new Uint8Array(await out.arrayBuffer());
  } catch {
    return null;
  }
}

/** A zip of the given files (deflated when the runtime can, stored otherwise). */
export async function zip(files: { name: string; data: Uint8Array }[], compress = true): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  // 1980-01-01 00:00 — a fixed stamp keeps the output reproducible.
  const dosTime = 0;
  const dosDate = (0 << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const packed = compress ? await deflateRaw(f.data) : null;
    const method = packed && packed.length < f.data.length ? 8 : 0;
    const body = method === 8 ? (packed as Uint8Array) : f.data;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, method, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, body);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, method, true);
    cd.setUint16(12, dosTime, true);
    cd.setUint16(14, dosDate, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, body.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** A one-sheet .xlsx: bold frozen header row, widths from the content. */
export async function buildXlsx(sheetName: string, columns: XlsxColumn[], rows: Row[], compress = true): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const files = workbookFiles(sheetName, sheetXml(columns, rows)).map((f) => ({ name: f.name, data: enc.encode(f.data) }));
  return zip(files, compress);
}
