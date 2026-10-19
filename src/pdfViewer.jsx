// 📄 PDFs that work everywhere (Elie 10/19/26: "Please allow pop-ups" in the
// phone app). Every "⭳ PDF / Generate" button used to open a blank pop-up
// window and print into it — the iPhone/Android app (and phone browsers) block
// that. Now:
//   • computer browser → unchanged: a new tab with the print dialog;
//   • phone app / phone browser / pop-up blocked → the report becomes a REAL
//     PDF on the device and opens in an in-app viewer with Share / Save
//     (same look as the payoff statement sheet).
// printHtml(html, {title, filename}) — for the HTML reports.
// showPdf(fileOrMaker, {title, subtitle}) — for jsPDF files we already build.
// openFile(file, {title}) — any file: PDFs in the viewer, others shared / opened.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { T } from "./theme";
import { isNative, nativeShareFiles } from "./native";

const isPhoneUA = () => typeof navigator !== "undefined" && (/iphone|ipad|ipod|android/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
export const inAppPdf = () => isNative() || isPhoneUA();

let pdfjsP = null;
const loadPdfjs = () => {
  if (!pdfjsP) {
    pdfjsP = Promise.all([
      import("pdfjs-dist/legacy/build/pdf.min.mjs"),
      import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
    ]).then(([pdfjs, worker]) => { pdfjs.GlobalWorkerOptions.workerSrc = worker.default; return pdfjs; });
  }
  return pdfjsP;
};

// Render an HTML report off-screen (letter width) and turn it into a PDF —
// page breaks land on a blank row where possible so text lines aren't cut.
export async function htmlToPdfFile(html, filename = "Report.pdf") {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const ifr = document.createElement("iframe");
  ifr.setAttribute("aria-hidden", "true");
  ifr.style.cssText = "position:fixed;left:-12000px;top:0;width:816px;height:1056px;border:0;opacity:0;pointer-events:none";
  document.body.appendChild(ifr);
  try {
    const d = ifr.contentDocument;
    d.open(); d.write(html); d.close();
    await new Promise((r) => { if (d.readyState === "complete") r(); else { ifr.onload = r; setTimeout(r, 2000); } });
    try { if (d.fonts && d.fonts.ready) await d.fonts.ready; } catch { /* fine */ }
    await Promise.all([...d.images].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; setTimeout(r, 3000); }))));
    const H = Math.max(d.body.scrollHeight, d.documentElement.scrollHeight, 200);
    ifr.style.height = H + "px";
    const canvas = await html2canvas(d.body, { scale: 2, backgroundColor: "#ffffff", useCORS: true, windowWidth: 816, windowHeight: H, logging: false });
    const pdf = new jsPDF({ unit: "pt", format: "letter" });
    const PW = 612, PH = 792, MT = 22, MB = 22;
    const pxPerPt = canvas.width / PW;
    const pageH = Math.floor((PH - MT - MB) * pxPerPt);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const blankRow = (y) => {
      const row = ctx.getImageData(0, y, canvas.width, 1).data;
      for (let i = 0; i < row.length; i += 16) if (row[i] < 245 || row[i + 1] < 245 || row[i + 2] < 245) return false;
      return true;
    };
    let y = 0, first = true;
    while (y < canvas.height - 2) {
      let h = Math.min(pageH, canvas.height - y);
      if (y + h < canvas.height) { // nudge the cut up to a blank row (≤ 15% of a page)
        for (let k = 0; k < pageH * 0.15; k += 2) { if (blankRow(y + h - k)) { h -= k; break; } }
      }
      const c = document.createElement("canvas");
      c.width = canvas.width; c.height = h;
      c.getContext("2d").drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      if (!first) pdf.addPage();
      pdf.addImage(c.toDataURL("image/jpeg", 0.9), "JPEG", 0, MT, PW, h / pxPerPt);
      first = false; y += h;
    }
    const name = /\.pdf$/i.test(filename) ? filename : `${filename}.pdf`;
    return new File([pdf.output("blob")], name.replace(/[\\/:*?"<>|]+/g, "-"), { type: "application/pdf" });
  } finally { ifr.remove(); }
}

function PdfSheet({ make, title, subtitle, onClose }) {
  const pagesRef = useRef(null);
  const [file, setFile] = useState(null);
  const [state, setState] = useState("busy"); // busy | ok | error
  const [msg, setMsg] = useState("");
  const phone = typeof window !== "undefined" && window.innerWidth < 700;
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [pdfjs, f] = await Promise.all([loadPdfjs(), make()]);
        if (dead) return;
        setFile(f);
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
        const host = pagesRef.current; if (!host || dead) return;
        host.innerHTML = "";
        const cssW = host.clientWidth || 340;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const v1 = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: (cssW / v1.width) * Math.min(3, (window.devicePixelRatio || 1) * 1.25) });
          const cv = document.createElement("canvas");
          cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
          cv.style.cssText = "width:100%;height:auto;display:block;background:#fff;border-radius:4px;box-shadow:0 4px 18px rgba(0,0,0,0.14);margin-bottom:12px";
          host.appendChild(cv);
          await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
        }
        if (!dead) setState("ok");
      } catch (e) { if (!dead) { setState("error"); setMsg((e && e.message) || "Couldn't make the PDF."); } }
    })();
    return () => { dead = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const download = () => {
    if (!file) return;
    const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  };
  const canShareFile = !!(file && (isNative() || (typeof navigator !== "undefined" && navigator.canShare && (() => { try { return navigator.canShare({ files: [file] }); } catch { return false; } })())));
  const share = async () => {
    if (!file) return;
    if (isNative()) { try { await nativeShareFiles([file]); } catch { /* cancelled */ } return; }
    if (canShareFile) { try { await navigator.share({ files: [file], title }); } catch { /* cancelled */ } return; }
    download(); setMsg("Saved — attach it to your email or WhatsApp.");
  };
  const btn = (primary) => ({ flex: 1, minHeight: 50, borderRadius: 25, border: "none", background: primary ? T.gold : "rgba(118,118,128,0.12)", color: primary ? "#fff" : T.text, fontWeight: 650, fontSize: 15.5, cursor: file ? "pointer" : "default", fontFamily: "inherit", opacity: file ? 1 : 0.55 });
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 3200, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: phone ? "flex-end" : "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.bg, width: phone ? "100%" : 600, maxHeight: phone ? "94vh" : "92vh", height: phone ? "94vh" : "auto", borderRadius: phone ? "28px 28px 0 0" : 24, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        {phone && <div style={{ width: 36, height: 5, borderRadius: 3, background: "rgba(60,60,67,0.3)", margin: "8px auto 0", flexShrink: 0 }} />}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px 6px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
            {subtitle && <div style={{ fontSize: 13, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, border: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <span style={{ width: 30, height: 30, borderRadius: 15, background: "rgba(118,118,128,0.12)", color: T.textSub, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>✕</span>
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain", padding: "8px 16px 12px", WebkitOverflowScrolling: "touch" }}>
          {state === "busy" && <div style={{ textAlign: "center", color: T.textSub, fontSize: 14, padding: "40px 0" }}>Making the PDF…</div>}
          {state === "error" && <div style={{ textAlign: "center", color: T.red, fontSize: 14, padding: "40px 0" }}>{msg}</div>}
          <div ref={pagesRef} />
        </div>
        <div style={{ flexShrink: 0, padding: "10px 16px calc(12px + env(safe-area-inset-bottom))", borderTop: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
          {msg && state === "ok" && <div style={{ fontSize: 13, color: T.textSub, textAlign: "center" }}>{msg}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button disabled={!file} onClick={share} style={btn(true)}>{canShareFile || !file ? "Share — WhatsApp, Email…" : "Download"}</button>
            {canShareFile && !isNative() && <button disabled={!file} onClick={download} style={{ ...btn(false), flex: "0 0 auto", padding: "0 20px" }}>Save</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

// Open the in-app viewer. `src` = a File, or a function returning one (async ok).
export function showPdf(src, { title = "PDF", subtitle = "" } = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => { root.unmount(); host.remove(); };
  const make = typeof src === "function" ? () => Promise.resolve(src()) : () => Promise.resolve(src);
  root.render(<PdfSheet make={make} title={title} subtitle={subtitle} onClose={close} />);
}

// HTML report → print dialog in a new tab on computers; in-app PDF elsewhere
// (or whenever the pop-up is blocked). Call it straight from the tap.
export function printHtml(html, { title = "Report", subtitle = "", filename } = {}) {
  if (!inAppPdf()) {
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html); w.document.close(); w.focus();
      setTimeout(() => { try { w.print(); } catch { /* user can print manually */ } }, 500);
      return;
    }
  }
  showPdf(() => htmlToPdfFile(html, filename || `${title}.pdf`), { title, subtitle });
}

// Any file the app made or fetched: PDFs → the viewer; others → share sheet in
// the app, a new tab elsewhere.
export function openFile(file, { title } = {}) {
  if (file && (/pdf/i.test(file.type || "") || /\.pdf$/i.test(file.name || ""))) {
    if (inAppPdf()) { showPdf(file, { title: title || file.name }); return; }
  }
  if (isNative()) { nativeShareFiles([file]).catch(() => {}); return; }
  const u = URL.createObjectURL(file);
  if (!window.open(u, "_blank")) { const a = document.createElement("a"); a.href = u; a.download = file.name || "file"; document.body.appendChild(a); a.click(); a.remove(); }
  setTimeout(() => URL.revokeObjectURL(u), 120000);
}
