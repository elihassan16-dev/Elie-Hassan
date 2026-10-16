// Read a file for Claude WITHOUT saving it anywhere (Elie 10/16/26: "read the
// PDF attached to this email and tell me what it says"). Used by the connector's
// read_file tool — the bytes come straight from Outlook / OneDrive / our storage
// and are only turned into something Claude can read:
//   • PDF   — the text of every page (in reading order); a page with no text
//             (a scan or a photo of a document) is sent as a picture instead.
//   • Image — sent as a picture (shrunk when huge).
//   • Word (.docx) / Excel (.xlsx) — their text / cells.
//   • Text, CSV, HTML, email (.eml) — as text.
// → { text, images: [{ data (base64), mimeType }] }

const TEXT_CAP = 60000;   // characters of text per call
const IMG_CAP = 6;        // pictures per call (scanned pages + images)
const IMG_MAX_PX = 1600;  // longest side of a picture we send

let pdfjsP = null;
function loadPdfjs() {
  if (!pdfjsP) {
    pdfjsP = (async () => {
      // Run the PDF worker in-process (no worker threads on the server).
      globalThis.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
      return import("pdfjs-dist/legacy/build/pdf.mjs");
    })();
  }
  return pdfjsP;
}
let canvasP = null;
const loadCanvas = () => (canvasP ||= import("@napi-rs/canvas"));

// "3", "2-5", "1,4,7-9" → sorted page numbers within 1..n (null = all).
export function parsePages(spec, n) {
  if (!spec) return null;
  const out = new Set();
  for (const part of String(spec).split(/[,\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = Math.max(1, +m[1]), b = Math.min(n, m[2] ? +m[2] : +m[1]);
    for (let i = a; i <= b; i++) out.add(i);
  }
  return out.size ? [...out].sort((x, y) => x - y) : null;
}

// One page's text, line by line in reading order.
async function pageText(page) {
  const tc = await page.getTextContent();
  const lines = [];
  for (const it of tc.items) {
    if (!it.str && !it.hasEOL) continue;
    const y = it.transform[5], x = it.transform[4];
    let ln = lines.find((l) => Math.abs(l.y - y) < Math.max(2, (it.height || 10) * 0.45));
    if (!ln) { ln = { y, parts: [] }; lines.push(ln); }
    ln.parts.push({ x, s: it.str || "", w: it.width || 0 });
  }
  lines.sort((a, b) => b.y - a.y);
  return lines.map((l) => {
    l.parts.sort((a, b) => a.x - b.x);
    let s = "", end = null;
    for (const p of l.parts) {
      if (end !== null && p.s) s += p.x - end > 12 ? "   " : p.x - end > 1.5 && !/\s$/.test(s) && !/^\s/.test(p.s) ? " " : "";
      s += p.s; end = p.x + p.w;
    }
    return s.replace(/\s+$/, "");
  }).filter((s) => s.trim()).join("\n");
}

async function renderPage(page) {
  const { createCanvas } = await loadCanvas();
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(2.5, IMG_MAX_PX / Math.max(base.width, base.height)) });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return { data: (await canvas.encode("jpeg", 82)).toString("base64"), mimeType: "image/jpeg" };
}

async function readPdf(buf, pagesSpec) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  try {
    const n = doc.numPages;
    const want = parsePages(pagesSpec, n) || Array.from({ length: n }, (_, i) => i + 1);
    const parts = [], images = [], scanned = [], skipped = [];
    let used = 0, stoppedAt = null;
    for (const num of want) {
      if (used >= TEXT_CAP) { stoppedAt = num; break; }
      const page = await doc.getPage(num);
      let t = "";
      try { t = await pageText(page); } catch { t = ""; }
      if (t.replace(/\s/g, "").length < 25) {
        // No real text → a scan. Send the page as a picture so Claude can read it.
        if (images.length < IMG_CAP) {
          try { images.push(await renderPage(page)); scanned.push(num); parts.push(`── Page ${num} of ${n} ── (scanned — sent as a picture)`); }
          catch { parts.push(`── Page ${num} of ${n} ── (scanned page — couldn't turn it into a picture)`); }
        } else skipped.push(num);
      } else {
        const room = TEXT_CAP - used;
        const body = t.length > room ? t.slice(0, room) + "\n…(cut off)" : t;
        parts.push(`── Page ${num} of ${n} ──\n${body}`);
        used += body.length;
      }
      page.cleanup();
    }
    const notes = [];
    if (stoppedAt) notes.push(`Stopped at page ${stoppedAt} (too long for one read) — call again with pages="${stoppedAt}-${n}".`);
    if (skipped.length) notes.push(`Scanned pages not sent yet: ${skipped.join(", ")} — call again with pages="${skipped.join(",")}".`);
    return { text: `PDF · ${n} page${n === 1 ? "" : "s"}${scanned.length ? ` · ${scanned.length} scanned page${scanned.length === 1 ? "" : "s"} sent as picture${scanned.length === 1 ? "" : "s"}` : ""}\n\n${parts.join("\n\n")}${notes.length ? `\n\n${notes.join("\n")}` : ""}`, images };
  } finally { doc.destroy(); }
}

async function readImage(buf, type) {
  const okType = /^image\/(jpeg|png|gif|webp)$/.test(type);
  if (okType && buf.length <= 3.5 * 1024 * 1024) return { text: "Picture (shown below).", images: [{ data: buf.toString("base64"), mimeType: type }] };
  // HEIC / huge photos → shrink to a JPEG.
  try {
    const { createCanvas, loadImage } = await loadCanvas();
    const img = await loadImage(buf);
    const k = Math.min(1, IMG_MAX_PX / Math.max(img.width, img.height));
    const c = createCanvas(Math.round(img.width * k), Math.round(img.height * k));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return { text: "Picture (shown below).", images: [{ data: (await c.encode("jpeg", 82)).toString("base64"), mimeType: "image/jpeg" }] };
  } catch { return { text: "That picture's format can't be opened here — ask the sender for a JPG or PDF.", images: [] }; }
}

const xmlText = (s) => String(s).replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, "&");

async function unzip(buf) { const { unzipSync, strFromU8 } = await import("fflate"); const z = unzipSync(new Uint8Array(buf)); return { z, str: (k) => (z[k] ? strFromU8(z[k]) : "") }; }

async function readDocx(buf) {
  const { str } = await unzip(buf);
  const xml = str("word/document.xml");
  if (!xml) throw new Error("not a Word file");
  const text = xmlText(xml.replace(/<w:tab\/>/g, "\t").replace(/<w:br[^>]*\/>/g, "\n").replace(/<\/w:p>/g, "\n").replace(/<\/w:tc>/g, "\t")).replace(/\n{3,}/g, "\n\n").trim();
  return { text: `Word document\n\n${text}`, images: [] };
}

async function readXlsx(buf) {
  const { z, str } = await unzip(buf);
  const shared = [...str("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1]));
  const names = [...str("xl/workbook.xml").matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => xmlText(m[1]));
  const sheets = Object.keys(z).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  const out = [];
  sheets.forEach((k, i) => {
    const rows = [...str(k).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => [...r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
      const t = (c[1].match(/t="(\w+)"/) || [])[1], body = c[2] || "";
      const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (t === "s") return shared[+v] || "";
      if (t === "inlineStr") return xmlText(body);
      return v != null ? xmlText(v) : "";
    }).join("\t").replace(/\t+$/, "")).filter((r) => r.trim());
    out.push(`── Sheet: ${names[i] || `Sheet ${i + 1}`} ──\n${rows.join("\n")}`);
  });
  return { text: `Excel workbook\n\n${out.join("\n\n")}`, images: [] };
}

const htmlish = (s) => String(s).replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n{3,}/g, "\n\n").trim();

export async function readFileContent(file, { pages } = {}) {
  const { name = "file", buf } = file;
  const ext = (String(name).match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || "";
  let type = String(file.type || "").split(";")[0].toLowerCase();
  const isPdf = type === "application/pdf" || ext === "pdf" || buf.subarray(0, 5).toString("latin1") === "%PDF-";
  if (isPdf) return readPdf(buf, pages);
  if (type.startsWith("image/") || /^(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/.test(ext)) {
    if (!type.startsWith("image/")) type = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
    return readImage(buf, type);
  }
  if (ext === "docx" || /wordprocessingml/.test(type)) return readDocx(buf);
  if (ext === "xlsx" || /spreadsheetml/.test(type)) return readXlsx(buf);
  if (ext === "doc" || ext === "xls") return { text: `"${name}" is an old-style Office file (.${ext}) that can't be opened here — ask for a PDF or the newer .${ext}x version.`, images: [] };
  if (type.startsWith("text/") || /^(txt|csv|tsv|md|json|xml|html?|eml|ics|vcf|log)$/.test(ext) || /json|xml|rfc822/.test(type)) {
    let t = buf.toString("utf8");
    if (/html?$/.test(ext) || /html/.test(type)) t = htmlish(t);
    return { text: t.length > TEXT_CAP ? t.slice(0, TEXT_CAP) + "\n…(cut off)" : t, images: [] };
  }
  return { text: `"${name}" (${type || ext || "unknown type"}) isn't a kind of file that can be read here — PDFs, pictures, Word, Excel and text files can.`, images: [] };
}
