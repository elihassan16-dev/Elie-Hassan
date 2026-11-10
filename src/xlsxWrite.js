// Tiny real-Excel (.xlsx) writer — no library, just fflate's zip (Elie 11/10/26:
// Bank Reconciliation → ⬇ Excel). Cells are plain values or {v, s} with a
// style name below; money cells are real numbers ($ format, negatives red in
// brackets) so Excel can add them up.
import { zipSync, strToU8 } from "fflate";

// style name → cellXfs index (order must match XF below)
const S = { text: 0, title: 1, sub: 2, head: 3, headR: 4, sec: 5, money: 6, moneyB: 7, bold: 8, int: 9, intB: 10, totalLbl: 11, totalMoney: 12, gold: 13, goldMoney: 14, green: 15, red: 16 };
const XF = [
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>',
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyFont="1"/>',
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" applyFont="1"/>',
  '<xf numFmtId="0" fontId="3" fillId="2" borderId="0" applyFont="1" applyFill="1"/>',
  '<xf numFmtId="0" fontId="3" fillId="2" borderId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right"/></xf>',
  '<xf numFmtId="0" fontId="4" fillId="3" borderId="0" applyFont="1" applyFill="1"/>',
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>',
  '<xf numFmtId="164" fontId="5" fillId="0" borderId="0" applyNumberFormat="1" applyFont="1"/>',
  '<xf numFmtId="0" fontId="5" fillId="0" borderId="0" applyFont="1"/>',
  '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>',
  '<xf numFmtId="3" fontId="5" fillId="0" borderId="1" applyNumberFormat="1" applyFont="1" applyBorder="1"/>',
  '<xf numFmtId="0" fontId="5" fillId="0" borderId="1" applyFont="1" applyBorder="1"/>',
  '<xf numFmtId="164" fontId="5" fillId="0" borderId="1" applyNumberFormat="1" applyFont="1" applyBorder="1"/>',
  '<xf numFmtId="0" fontId="5" fillId="4" borderId="0" applyFont="1" applyFill="1"/>',
  '<xf numFmtId="164" fontId="5" fillId="4" borderId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>',
  '<xf numFmtId="0" fontId="6" fillId="0" borderId="0" applyFont="1"/>',
  '<xf numFmtId="0" fontId="7" fillId="0" borderId="0" applyFont="1"/>',
];
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00;[Red]\\(&quot;$&quot;#,##0.00\\)"/></numFmts>
<fonts count="8">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="15"/><name val="Calibri"/></font>
<font><sz val="10"/><color rgb="FF777777"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF7A5F1C"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><sz val="11"/><color rgb="FF0F7B3F"/><name val="Calibri"/></font>
<font><sz val="11"/><color rgb="FFC00000"/><name val="Calibri"/></font>
</fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFB8963E"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF4EEDD"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFBF7EC"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="medium"><color rgb="FF333333"/></top><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${XF.length}">${XF.join("")}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const colName = (i) => { let s = ""; i += 1; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

// Excel tab names: ≤31 chars, none of : \ / ? * [ ], unique.
export function sheetNames(names) {
  const used = new Set();
  return names.map((n) => {
    let base = String(n || "Sheet").replace(/[:\\/?*[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
    let out = base, k = 2;
    while (used.has(out.toLowerCase())) { const suf = ` (${k++})`; out = base.slice(0, 31 - suf.length) + suf; }
    used.add(out.toLowerCase());
    return out;
  });
}

function sheetXml({ cols = [], rows = [], merges = [] }) {
  const colsXml = cols.length ? `<cols>${cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
  const rowsXml = rows.map((r, ri) => {
    const cells = (r || []).map((c, ci) => {
      if (c == null || c === "") return "";
      const cell = typeof c === "object" ? c : { v: c };
      const ref = colName(ci) + (ri + 1);
      const st = S[cell.s] != null ? S[cell.s] : (typeof cell.v === "number" ? S.money : S.text);
      if (cell.v == null || cell.v === "") return `<c r="${ref}" s="${st}"/>`;
      if (typeof cell.v === "number" && isFinite(cell.v)) return `<c r="${ref}" s="${st}"><v>${Math.round(cell.v * 100) / 100}</v></c>`;
      return `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${esc(cell.v)}</t></is></c>`;
    }).join("");
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join("");
  const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0" showGridLines="1"/></sheetViews><sheetFormatPr defaultRowHeight="16"/>${colsXml}<sheetData>${rowsXml}</sheetData>${mergeXml}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="portrait" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

// sheets: [{name, cols:[widths], rows:[[cell…]], merges:["A1:E1"]}] → Blob
export function buildXlsx(sheets) {
  const names = sheetNames(sheets.map((s) => s.name));
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": STYLES,
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s); });
  const zipped = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])), { level: 6 });
  return new Blob([zipped], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
