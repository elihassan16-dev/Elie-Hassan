// Inline Scope-of-Work PDF preview. iOS Safari can't show a PDF inside the
// page (an iframe/embed renders nothing), so this draws the REAL generated
// PDF — the same bytes the contractor receives — onto canvases with pdf.js.
// Both pdf.js and jsPDF load on demand, so app launch stays lean.
import { useEffect, useRef, useState } from "react";
import { T } from "../theme";
import { sowPdfFile } from "./sowPdf";

let pdfjsPromise = null;
const loadPdfjs = () => {
  if (!pdfjsPromise) {
    // The "legacy" build carries pdf.js's own polyfills — the modern build
    // needs bleeding-edge JS (Map.getOrInsertComputed) that older iOS lacks.
    pdfjsPromise = Promise.all([
      import("pdfjs-dist/legacy/build/pdf.min.mjs"),
      import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }
  return pdfjsPromise;
};

export function SowPdfPreview({ job }) {
  const hostRef = useRef(null);
  const seqRef = useRef(0); // ignore stale renders when the scope changes mid-build
  const [state, setState] = useState("busy"); // busy | ok | error
  const key = [job.scope, job.title, job.propertyAddress, job.scopeEditedAt, (job.scopeChangedLines || []).join("|")].join("\u0000");
  useEffect(() => {
    const seq = ++seqRef.current;
    (async () => {
      setState("busy");
      try {
        const [pdfjs, file] = await Promise.all([loadPdfjs(), sowPdfFile(job)]);
        const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
        const host = hostRef.current;
        if (seq !== seqRef.current || !host) return;
        const width = Math.min(host.clientWidth || 320, 680);
        const dpr = Math.min(window.devicePixelRatio || 1, 2); // 2x is plenty — 3x canvases blow iOS memory
        const pages = [];
        for (let p = 1; p <= doc.numPages; p++) {
          const page = await doc.getPage(p);
          const vp = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * dpr });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(vp.width);
          canvas.height = Math.floor(vp.height);
          Object.assign(canvas.style, { width: "100%", display: "block", borderRadius: "8px", boxShadow: "0 1px 10px rgba(0,0,0,0.16)", background: "#fff" });
          await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
          pages.push(canvas);
        }
        if (seq !== seqRef.current || !hostRef.current) return;
        hostRef.current.replaceChildren(...pages);
        setState("ok");
      } catch (e) {
        console.error("[sow-preview] render failed:", e);
        if (seq === seqRef.current) setState("error");
      }
    })();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ position: "relative", minHeight: 180 }}>
      {/* Rendering failed (ancient browser / out of memory) → readable text beats a blank box. */}
      {state === "error"
        ? <div style={{ fontSize: 13, color: T.textSub, whiteSpace: "pre-wrap", lineHeight: 1.55, background: "#fff", border: `1px solid ${T.border}`, borderRadius: 8, padding: "14px 16px" }}>{job.scope}</div>
        : <div ref={hostRef} style={{ display: "flex", flexDirection: "column", gap: 12, opacity: state === "busy" ? 0.35 : 1, transition: "opacity 0.2s" }} />}
      {state === "busy" && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#8a6d1f" }}>⏳ Building the PDF…</div>
      )}
    </div>
  );
}
