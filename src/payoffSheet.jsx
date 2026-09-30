// 📄 Payoff statement preview (Elie 9/30/26): the REAL PDF drawn onto canvases
// with pdf.js (iOS can't show a PDF inside the page), plus Share — the phone's
// share sheet carries WhatsApp, Mail, Messages — and Download.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { T } from "./theme";
import { payoffPdfFile } from "./payoffPdf";

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

export function PayoffStatementSheet({ spec, onClose, isMobile }) {
  const pagesRef = useRef(null);
  const [file, setFile] = useState(null);
  const [state, setState] = useState("busy"); // busy | ok | error
  const [msg, setMsg] = useState("");
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [pdfjs, f] = await Promise.all([loadPdfjs(), payoffPdfFile(spec)]);
        if (dead) return;
        setFile(f);
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
        const host = pagesRef.current; if (!host || dead) return;
        host.innerHTML = "";
        const cssW = host.clientWidth || 340;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const v1 = page.getViewport({ scale: 1 });
          const scale = (cssW / v1.width) * Math.min(3, (window.devicePixelRatio || 1) * 1.25);
          const vp = page.getViewport({ scale });
          const cv = document.createElement("canvas");
          cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
          cv.style.cssText = `width:100%;height:auto;display:block;background:#fff;border-radius:4px;box-shadow:0 4px 18px rgba(0,0,0,0.14);margin-bottom:12px`;
          host.appendChild(cv);
          await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
        }
        if (!dead) setState("ok");
      } catch (e) { if (!dead) { setState("error"); setMsg(e.message || "Couldn't build the statement."); } }
    })();
    return () => { dead = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const download = () => {
    if (!file) return;
    const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  };
  const canShareFile = !!(file && typeof navigator !== "undefined" && navigator.canShare && navigator.canShare({ files: [file] }));
  const share = async () => {
    if (!file) return;
    if (canShareFile) { try { await navigator.share({ files: [file], title: `Payoff statement — ${spec.property || ""}` }); } catch { /* cancelled */ } return; }
    download(); setMsg("Saved — attach it to your email or WhatsApp.");
  };
  const btn = (primary) => ({ flex: 1, minHeight: 50, borderRadius: 25, border: "none", background: primary ? T.gold : "rgba(118,118,128,0.12)", color: primary ? "#fff" : T.text, fontWeight: 650, fontSize: 15.5, cursor: file ? "pointer" : "default", fontFamily: "inherit", opacity: file ? 1 : 0.55 });
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 3200, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.bg, width: isMobile ? "100%" : 560, maxHeight: isMobile ? "94vh" : "92vh", borderRadius: isMobile ? "28px 28px 0 0" : 24, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        {isMobile && <div style={{ width: 36, height: 5, borderRadius: 3, background: "rgba(60,60,67,0.3)", margin: "8px auto 0", flexShrink: 0 }} />}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px 6px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: T.text }}>Payoff statement</div>
            <div style={{ fontSize: 13, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{spec.funderName ? `${spec.funderName} · ` : ""}{spec.property}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, border: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <span style={{ width: 30, height: 30, borderRadius: 15, background: "rgba(118,118,128,0.12)", color: T.textSub, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>✕</span>
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain", padding: "8px 16px 12px" }}>
          {state === "busy" && <div style={{ textAlign: "center", color: T.textSub, fontSize: 14, padding: "40px 0" }}>Making the statement…</div>}
          {state === "error" && <div style={{ textAlign: "center", color: T.red, fontSize: 14, padding: "40px 0" }}>{msg}</div>}
          <div ref={pagesRef} />
        </div>
        <div style={{ flexShrink: 0, padding: "10px 16px calc(12px + env(safe-area-inset-bottom))", borderTop: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
          {msg && state === "ok" && <div style={{ fontSize: 13, color: T.textSub, textAlign: "center" }}>{msg}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button disabled={!file} onClick={share} style={btn(true)}>{canShareFile || !file ? "Share — WhatsApp, Email…" : "Download to send"}</button>
            {canShareFile && <button disabled={!file} onClick={download} style={{ ...btn(false), flex: "0 0 auto", padding: "0 20px" }}>Save</button>}
          </div>
        </div>
      </div>
    </div>, document.body);
}
