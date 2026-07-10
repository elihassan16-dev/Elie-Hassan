// Inline Scope-of-Work PDF preview. iOS Safari can't show a PDF inside the
// page (an iframe/embed renders nothing), so this draws the REAL generated
// PDF — the same bytes the contractor receives — onto canvases with pdf.js.
// Both pdf.js and jsPDF load on demand, so app launch stays lean.
// Zoom: the app viewport locks browser pinch-zoom (user-scalable=no), so the
// preview implements its own — pinch, double-tap, or the − / + pill. Pages
// re-rasterize at the committed zoom so zoomed text stays sharp.
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

const clampZoom = (z) => Math.min(3, Math.max(1, z));

export function SowPdfPreview({ job }) {
  const wrapRef = useRef(null); // x-scroll wrapper, receives the pinch gestures
  const innerRef = useRef(null); // width = zoom × 100%, holds the page canvases
  const seqRef = useRef(0); // ignore stale builds when the scope changes mid-flight
  const docRef = useRef(null);
  const [doc, setDoc] = useState(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1); zoomRef.current = zoom;
  const [state, setState] = useState("busy"); // busy | ok | error
  const key = [job.scope, job.title, job.propertyAddress, job.scopeEditedAt, (job.scopeChangedLines || []).join("|")].join("\u0000");

  // Build the PDF once per scope change; zooming reuses the parsed document.
  useEffect(() => {
    const seq = ++seqRef.current;
    (async () => {
      setState("busy");
      try {
        const [pdfjs, file] = await Promise.all([loadPdfjs(), sowPdfFile(job)]);
        const built = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
        if (seq !== seqRef.current) { built.destroy(); return; }
        if (docRef.current) docRef.current.destroy();
        docRef.current = built;
        setDoc(built);
      } catch (e) {
        console.error("[sow-preview] build failed:", e);
        if (seq === seqRef.current) setState("error");
      }
    })();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { seqRef.current++; if (docRef.current) docRef.current.destroy(); }, []);

  // Paint every page at the committed zoom — re-runs when a pinch ends, so the
  // zoomed text is re-rasterized crisp instead of CSS-stretched blurry.
  useEffect(() => {
    if (!doc) return;
    let stale = false;
    (async () => {
      try {
        const baseW = Math.min(wrapRef.current?.clientWidth || 320, 680);
        const dpr = Math.min(window.devicePixelRatio || 1, 2); // 3x canvases blow iOS memory
        // iOS also kills very large canvases — cap the raster; CSS stretches the rest.
        const px = Math.min(baseW * zoom * dpr, 2600);
        const pages = [];
        for (let p = 1; p <= doc.numPages; p++) {
          const page = await doc.getPage(p);
          const vp = page.getViewport({ scale: px / page.getViewport({ scale: 1 }).width });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(vp.width);
          canvas.height = Math.floor(vp.height);
          Object.assign(canvas.style, { width: "100%", height: "auto", display: "block", borderRadius: "8px", boxShadow: "0 1px 10px rgba(0,0,0,0.16)", background: "#fff" });
          await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
          pages.push(canvas);
        }
        if (stale || doc !== docRef.current || !innerRef.current) return;
        innerRef.current.replaceChildren(...pages);
        setState("ok");
      } catch (e) {
        console.error("[sow-preview] render failed:", e);
        if (!stale && doc === docRef.current) setState("error");
      }
    })();
    return () => { stale = true; };
  }, [doc, zoom]);

  // Gestures. Native listeners — React attaches touch handlers passive, and a
  // pinch must preventDefault or iOS scrolls instead. During the pinch the
  // container is CSS-scaled live (cheap); releasing commits the zoom (sharp).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let startDist = 0, startZoom = 1, live = 0, lastTap = 0;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e) => {
      if (e.touches.length === 2) { e.preventDefault(); startDist = dist(e.touches); startZoom = zoomRef.current; live = startZoom; }
    };
    const onMove = (e) => {
      if (e.touches.length === 2 && startDist) {
        e.preventDefault();
        live = clampZoom(startZoom * (dist(e.touches) / startDist));
        if (innerRef.current) innerRef.current.style.width = `${live * 100}%`;
      }
    };
    const onEnd = (e) => {
      if (startDist && e.touches.length < 2) { startDist = 0; setZoom(live); return; }
      if (e.touches.length === 0 && e.changedTouches.length === 1) {
        const now = Date.now();
        if (now - lastTap < 300) { lastTap = 0; setZoom(zoomRef.current > 1 ? 1 : 2); }
        else lastTap = now;
      }
    };
    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    return () => { el.removeEventListener("touchstart", onStart); el.removeEventListener("touchmove", onMove); el.removeEventListener("touchend", onEnd); };
  }, []);

  const zBtn = { width: 30, height: 30, border: "none", background: "transparent", fontSize: 16, fontWeight: 700, color: T.textSub, cursor: "pointer", fontFamily: "inherit", padding: 0, lineHeight: 1 };
  return (
    <div style={{ position: "relative", minHeight: 180 }}>
      {/* Rendering failed (ancient browser / out of memory) → readable text beats a blank box. */}
      {state === "error"
        ? <div style={{ fontSize: 13, color: T.textSub, whiteSpace: "pre-wrap", lineHeight: 1.55, background: "#fff", border: `1px solid ${T.border}`, borderRadius: 8, padding: "14px 16px" }}>{job.scope}</div>
        : <>
            <div style={{ position: "sticky", top: 2, zIndex: 3, height: 0, display: "flex", justifyContent: "flex-end", pointerEvents: "none" }}>
              <div style={{ pointerEvents: "auto", display: "flex", alignItems: "center", background: "rgba(255,255,255,0.95)", border: `1px solid ${T.border}`, borderRadius: 18, padding: "2px 5px", boxShadow: "0 2px 10px rgba(0,0,0,0.12)", marginRight: 2 }}>
                <button onClick={() => setZoom((z) => clampZoom(Math.round((z / 1.25) * 100) / 100))} style={zBtn} title="Zoom out">−</button>
                <button onClick={() => setZoom(1)} style={{ ...zBtn, width: "auto", minWidth: 40, fontSize: 11 }} title="Reset zoom">{Math.round(zoom * 100)}%</button>
                <button onClick={() => setZoom((z) => clampZoom(Math.round(z * 1.25 * 100) / 100))} style={zBtn} title="Zoom in">+</button>
              </div>
            </div>
            <div ref={wrapRef} style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", touchAction: "pan-x pan-y" }}>
              <div ref={innerRef} style={{ width: `${zoom * 100}%`, display: "flex", flexDirection: "column", gap: 12, opacity: state === "busy" ? 0.35 : 1, transition: "opacity 0.2s" }} />
            </div>
          </>}
      {state === "busy" && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#8a6d1f" }}>⏳ Building the PDF…</div>
      )}
    </div>
  );
}
