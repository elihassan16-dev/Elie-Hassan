// 🖼 One full-screen photo/video viewer for the whole app, iPhone-Photos style
// (Elie 10/20/26 — "swipe right and left through all the pictures"): Media
// page, the chat 🖼 gallery, chat bubbles and the contractor portal all use it.
//   • top: ‹ back · title pill (property / who + date) · ••• menu
//   • middle: swipe left/right between items (the neighbours slide in with the
//     finger), swipe down to close, pinch / double-tap to zoom where you touch,
//     tap to hide the chrome (black background, like Photos)
//   • bottom: thumbnail strip (tap to jump) + Share · Save · Delete toolbar
// Items: { key, kind:"image"|"video", url, embed?, thumb?, title?, sub?, ext?,
//          file? (what Save/Share hand over: {kind,url,uid,name,mime}) }
// actions(it) → extra ••• rows [{k,label,icon,run,red}]; onDelete(it) adds 🗑.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { T } from "./theme";
import { saveItem, shareItem, isPhone } from "./fileSave";

const vw = () => (typeof window !== "undefined" ? window.innerWidth : 400);
const fmtWhen = (t) => { try { const d = new Date(t); if (isNaN(d)) return ""; const today = new Date(); const y = new Date(Date.now() - 86400000); const same = (a, b) => a.toDateString() === b.toDateString(); const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); return same(d, today) ? `Today ${time}` : same(d, y) ? `Yesterday ${time}` : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) })} ${time}`; } catch { return ""; } };
export const viewerWhen = fmtWhen;

function Slide({ it, active, zoom }) {
  if (!it) return null;
  if (it.kind === "image") return <img src={it.url} alt={it.name || "photo"} draggable={false} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block", userSelect: "none", WebkitUserSelect: "none", transform: zoom, transformOrigin: "0 0" }} />;
  if (!active) return it.thumb ? <img src={it.thumb} alt="" draggable={false} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }} /> : <div style={{ width: "70%", aspectRatio: "16/9", background: "#111", borderRadius: 8 }} />;
  if (it.embed) return <iframe key={it.key} src={it.embed} title={it.name || "video"} allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none", background: "#000" }} />;
  if (!it.url) return <div style={{ color: "#fff", fontSize: 15 }}>Still processing…</div>;
  return <video key={it.key} src={it.url} controls playsInline autoPlay style={{ maxWidth: "100%", maxHeight: "100%", display: "block", background: "#000" }} />;
}

export function PhotoViewer({ items, index = 0, onClose, actions, onDelete, deleteConfirm }) {
  const n = items.length;
  const [idx, setIdx] = useState(Math.max(0, Math.min(index, n - 1)));
  const [scale, setScale] = useState(1), [tx, setTx] = useState(0), [ty, setTy] = useState(0);
  const [dx, setDx] = useState(0), [dy, setDy] = useState(0), [dragging, setDragging] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [menu, setMenu] = useState(false);
  const [status, setStatus] = useState("");
  const boxRef = useRef(null), stripRef = useRef(null);
  const st = useRef({}); st.current = { s: scale, tx, ty, idx, n };
  const g = useRef({ mode: null });
  const nav = useRef({});
  const x = items[idx];
  nav.current = {
    go: (d) => setIdx((i) => Math.max(0, Math.min(st.current.n - 1, i + d))),
    close: onClose,
    toggle: () => setChrome((c) => !c),
  };
  useEffect(() => { if (idx > n - 1) setIdx(Math.max(0, n - 1)); }, [n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!n) onClose(); }, [n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setScale(1); setTx(0); setTy(0); setStatus(""); setMenu(false); }, [idx]);
  useEffect(() => { [idx - 1, idx + 1].forEach((i) => { const it = items[i]; if (it && it.kind === "image") { const im = new Image(); im.src = it.url; } }); }, [idx, items]);
  useEffect(() => { // keep the current thumbnail in view
    const s = stripRef.current; const el = s && s.children[idx];
    if (el) s.scrollTo({ left: el.offsetLeft - s.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" });
  }, [idx, chrome]);
  useEffect(() => {
    const k = (e) => { if (e.key === "ArrowLeft") nav.current.go(-1); else if (e.key === "ArrowRight") nav.current.go(1); else if (e.key === "Escape") nav.current.close(); };
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, []);

  const clampT = (s, ntx, nty) => {
    const el = boxRef.current;
    if (!el || s <= 1) return { tx: 0, ty: 0 };
    const W = el.clientWidth, H = el.clientHeight;
    return { tx: Math.min(0, Math.max(W - W * s, ntx)), ty: Math.min(0, Math.max(H - H * s, nty)) };
  };
  const applyZoom = (rawS, fx, fy) => {
    const { s, tx: ctx, ty: cty } = st.current;
    const ns = Math.min(6, Math.max(1, rawS));
    const px = (fx - ctx) / s, py = (fy - cty) / s;
    const c = clampT(ns, fx - px * ns, fy - py * ns);
    setScale(ns); setTx(c.tx); setTy(c.ty);
  };
  // Native non-passive touch listeners so the browser's own pinch can be stopped.
  useEffect(() => {
    const el = boxRef.current; if (!el) return;
    const pt = (t) => { const r = el.getBoundingClientRect(); return { x: t.clientX - r.left, y: t.clientY - r.top }; };
    const start = (e) => {
      if (e.target.closest && e.target.closest("[data-pv-nogesture]")) return;
      if (e.touches.length === 2) {
        e.preventDefault();
        const a = pt(e.touches[0]), b = pt(e.touches[1]);
        g.current = { mode: "pinch", d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), s0: st.current.s };
        setDragging(false); setDx(0); setDy(0);
      } else if (e.touches.length === 1) {
        const p = pt(e.touches[0]);
        g.current = { mode: st.current.s > 1 ? "pan" : "swipe", last: p, startP: p, startT: Date.now(), moved: false, axis: null };
      }
    };
    const move = (e) => {
      const G = g.current;
      if (e.touches.length === 2 && G.mode === "pinch") {
        e.preventDefault();
        const a = pt(e.touches[0]), b = pt(e.touches[1]);
        applyZoom(G.s0 * (Math.hypot(a.x - b.x, a.y - b.y) / G.d0), (a.x + b.x) / 2, (a.y + b.y) / 2);
      } else if (e.touches.length === 1 && G.mode === "pan") {
        e.preventDefault();
        const p = pt(e.touches[0]);
        const { s, tx: ctx, ty: cty } = st.current;
        const c = clampT(s, ctx + (p.x - G.last.x), cty + (p.y - G.last.y));
        setTx(c.tx); setTy(c.ty); G.last = p; G.moved = true;
      } else if (e.touches.length === 1 && G.mode === "swipe") {
        e.preventDefault();
        const p = pt(e.touches[0]);
        const mx = p.x - G.startP.x, my = p.y - G.startP.y;
        if (!G.axis && Math.hypot(mx, my) > 8) G.axis = Math.abs(mx) > Math.abs(my) ? "x" : "y";
        if (G.axis) {
          G.moved = true; setDragging(true);
          const { idx: i, n: N } = st.current;
          if (G.axis === "x") setDx((i === 0 && mx > 0) || (i === N - 1 && mx < 0) ? mx / 3 : mx);
          else setDy(Math.max(0, my));
        }
      }
    };
    const end = (e) => {
      const G = g.current;
      if (G.mode === "swipe" && e.changedTouches.length === 1 && st.current.s === 1) {
        const p = pt(e.changedTouches[0]);
        const mx = p.x - G.startP.x, my = p.y - G.startP.y;
        const fast = Date.now() - G.startT < 250;
        setDragging(false); setDx(0); setDy(0);
        if (G.axis === "x" && (Math.abs(mx) > el.clientWidth * 0.22 || (fast && Math.abs(mx) > 40))) nav.current.go(mx < 0 ? 1 : -1);
        else if (G.axis === "y" && my > 110) nav.current.close();
        else if (!G.moved) {
          const now = Date.now();
          if (el._lastTap && now - el._lastTap < 300) { clearTimeout(el._tapT); applyZoom(2.6, p.x, p.y); el._lastTap = 0; }
          else { el._lastTap = now; el._tapT = setTimeout(() => { if (el._lastTap === now) nav.current.toggle(); }, 300); }
        }
      } else if (G.mode === "pan" && !G.moved && e.changedTouches.length === 1) {
        const now = Date.now();
        if (el._lastTap && now - el._lastTap < 300) { setScale(1); setTx(0); setTy(0); el._lastTap = 0; }
        else el._lastTap = now;
      }
      if (e.touches.length === 0) g.current = { mode: null };
    };
    el.addEventListener("touchstart", start, { passive: false });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end, { passive: false });
    el.addEventListener("touchcancel", end, { passive: false });
    return () => { el.removeEventListener("touchstart", start); el.removeEventListener("touchmove", move); el.removeEventListener("touchend", end); el.removeEventListener("touchcancel", end); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!x) return null;
  const fileOf = (it) => it.file || { kind: it.kind, url: it.url, uid: it.uid, name: it.name, mime: it.mime };
  const run = async (fn) => {
    if (status && !/^✓|^Ready/.test(status)) return;
    try {
      const r = await fn(fileOf(x), setStatus);
      setStatus(r === "again" ? "Ready — tap again" : r === "cancel" ? "" : r === "downloaded" ? "✓ Downloaded" : "✓ Saved");
      if (r !== "again") setTimeout(() => setStatus(""), 2200);
    } catch (e) { setStatus(""); alert((e && e.message) || "Couldn't get the file — try again."); }
  };
  const del = () => {
    if (!onDelete) return;
    if (!window.confirm(deleteConfirm ? deleteConfirm(x) : "Delete this?")) return;
    onDelete(x);
  };
  const phone = isPhone();
  const rows = [
    { k: "save", label: phone ? "Save to phone" : "Save to computer", icon: "⬇", run: () => run(saveItem) },
    { k: "share", label: "Share…", icon: "⤴", run: () => run(shareItem) },
    ...((actions && actions(x)) || []),
    ...(onDelete ? [{ k: "del", label: "Delete", icon: "🗑", red: true, run: del }] : []),
  ];
  const dark = !chrome || scale > 1;
  const fade = dy > 0 ? Math.max(0.3, 1 - dy / 400) : 1;
  const bg = dark ? `rgba(0,0,0,${fade})` : `rgba(255,255,255,${fade})`;
  const W = boxRef.current ? boxRef.current.clientWidth : vw();
  const circle = { width: 46, height: 46, borderRadius: 23, border: "none", background: "rgba(255,255,255,0.92)", boxShadow: "0 2px 12px rgba(0,0,0,0.12), 0 0 0 0.5px rgba(0,0,0,0.06)", color: T.text, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontFamily: "inherit", flexShrink: 0, padding: 0 };
  const showChrome = chrome && !dragging && scale === 1;
  const zoomT = `translate(${tx}px,${ty}px) scale(${scale})`;
  const title = x.title || (x.kind === "video" ? "Video" : "Photo");
  const sub = x.sub != null ? x.sub : fmtWhen(x.at);
  return createPortal(
    <div onClick={(e) => e.stopPropagation()} style={{ position: "fixed", inset: 0, zIndex: 2600, background: bg, transition: dragging ? "none" : "background .2s", display: "flex", flexDirection: "column", overscrollBehavior: "contain" }}>
      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "max(10px, env(safe-area-inset-top)) 14px 8px", opacity: showChrome ? 1 : 0, pointerEvents: showChrome ? "auto" : "none", transition: "opacity .18s", zIndex: 3, flexShrink: 0 }}>
        <button onClick={onClose} aria-label="Back" style={circle}><svg width="12" height="20" viewBox="0 0 12 20" fill="none" stroke={T.text} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10 2 2 10l8 8" /></svg></button>
        <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "center" }}>
          <div style={{ maxWidth: "100%", padding: "6px 18px", borderRadius: 22, background: "rgba(255,255,255,0.92)", boxShadow: "0 2px 12px rgba(0,0,0,0.12), 0 0 0 0.5px rgba(0,0,0,0.06)", textAlign: "center", minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}{x.ext && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: "#B45309", background: "#FDE9C8", borderRadius: 8, padding: "1px 6px", verticalAlign: 2 }}>EXT</span>}</div>
            {sub && <div style={{ fontSize: 12.5, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>}
          </div>
        </div>
        <button onClick={() => setMenu((m) => !m)} aria-label="More" style={circle}><svg width="20" height="20" viewBox="0 0 20 20" fill={T.text}><circle cx="4" cy="10" r="1.9" /><circle cx="10" cy="10" r="1.9" /><circle cx="16" cy="10" r="1.9" /></svg></button>
      </div>
      {menu && <div onClick={() => setMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 4 }}>
        <div role="menu" onClick={(e) => e.stopPropagation()} style={{ position: "absolute", right: 14, top: "calc(max(10px, env(safe-area-inset-top)) + 58px)", width: 260, maxWidth: "calc(100vw - 28px)", background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 10px 40px rgba(0,0,0,0.25), 0 0 0 0.5px rgba(0,0,0,0.08)", padding: "4px 0", animation: "gsMenuIn .16s ease-out", transformOrigin: "top right" }}>
          {rows.map((r, i) => (
            <button key={r.k} role="menuitem" onClick={() => { setMenu(false); r.run(); }} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", minHeight: 48, padding: "0 16px", border: "none", borderTop: i === 0 ? "none" : r.red ? "6px solid rgba(118,118,128,0.10)" : "0.5px solid rgba(60,60,67,0.18)", background: "none", color: r.red ? T.red : T.text, fontSize: 16, fontFamily: "inherit", cursor: "pointer", textAlign: "left", gap: 12 }}>
              <span>{r.label}</span><span style={{ fontSize: 16 }}>{r.icon}</span>
            </button>
          ))}
        </div>
      </div>}

      {/* media */}
      <div ref={boxRef} style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden", touchAction: "none" }}>
        <div style={{ position: "absolute", inset: 0, transform: `translate(${dx}px, ${dy}px) scale(${dy > 0 ? Math.max(0.8, 1 - dy / 1500) : 1})`, transition: dragging ? "none" : "transform .25s cubic-bezier(.2,.8,.2,1)" }}>
          {[-1, 0, 1].map((o) => {
            const it = items[idx + o];
            return (
              <div key={it ? it.key : `e${o}`} style={{ position: "absolute", top: 0, bottom: 0, left: o * (W + 16), width: W, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {it && (o === 0 && it.kind === "image"
                  ? <div style={{ position: "absolute", inset: 0, transform: zoomT, transformOrigin: "0 0", display: "flex", alignItems: "center", justifyContent: "center", transition: g.current.mode ? "none" : "transform .2s" }}><Slide it={it} active /></div>
                  : <Slide it={it} active={o === 0} />)}
              </div>
            );
          })}
        </div>
        {/* Videos: the player eats touches, so the edges stay swipeable. */}
        {x.kind === "video" && <>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 70, width: 44, zIndex: 2 }} />
          <div style={{ position: "absolute", right: 0, top: 0, bottom: 70, width: 44, zIndex: 2 }} />
        </>}
        {n > 1 && vw() > 700 && showChrome && <>
          {idx > 0 && <button data-pv-nogesture onClick={() => nav.current.go(-1)} aria-label="Previous" style={{ ...circle, position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", zIndex: 3, fontSize: 22 }}>‹</button>}
          {idx < n - 1 && <button data-pv-nogesture onClick={() => nav.current.go(1)} aria-label="Next" style={{ ...circle, position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", zIndex: 3, fontSize: 22 }}>›</button>}
        </>}
        {status && <div style={{ position: "absolute", left: "50%", bottom: 14, transform: "translateX(-50%)", background: "rgba(28,28,30,0.85)", color: "#fff", fontSize: 13, fontWeight: 600, borderRadius: 16, padding: "7px 14px", zIndex: 3, whiteSpace: "nowrap" }}>{status}</div>}
      </div>

      {/* thumbnails + toolbar */}
      <div style={{ flexShrink: 0, opacity: showChrome ? 1 : 0, pointerEvents: showChrome ? "auto" : "none", transition: "opacity .18s", paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
        {n > 1 && <div ref={stripRef} style={{ display: "flex", gap: 3, overflowX: "auto", padding: "10px 50%", scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
          {items.map((it, i) => (
            <button key={it.key} onClick={() => setIdx(i)} aria-label={`Item ${i + 1}`} style={{ flexShrink: 0, width: i === idx ? 44 : 30, height: 44, borderRadius: 4, border: "none", padding: 0, overflow: "hidden", cursor: "pointer", background: "#D1D1D6", transition: "width .2s", margin: i === idx ? "0 6px" : 0, position: "relative" }}>
              {(it.thumb || it.kind === "image") && <img src={it.thumb || it.url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
              {it.kind === "video" && <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, textShadow: "0 1px 3px rgba(0,0,0,.6)" }}>▶</span>}
            </button>
          ))}
        </div>}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 18px 0", gap: 12 }}>
          <button onClick={() => run(shareItem)} aria-label="Share" style={circle}><svg width="20" height="22" viewBox="0 0 20 22" fill="none" stroke={T.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 14V2M5.5 6.5 10 2l4.5 4.5" /><path d="M6 9H4.5A1.5 1.5 0 0 0 3 10.5v8A1.5 1.5 0 0 0 4.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 15.5 9H14" /></svg></button>
          <div style={{ display: "flex", alignItems: "center", background: "rgba(255,255,255,0.92)", boxShadow: "0 2px 12px rgba(0,0,0,0.12), 0 0 0 0.5px rgba(0,0,0,0.06)", borderRadius: 23, height: 46, padding: "0 6px" }}>
            <button onClick={() => run(saveItem)} style={{ height: 46, padding: "0 16px", border: "none", background: "none", color: T.text, fontWeight: 650, fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}>⬇ Save</button>
            {n > 1 && <span style={{ fontSize: 13, color: T.textSub, padding: "0 10px", fontVariantNumeric: "tabular-nums" }}>{idx + 1} of {n}</span>}
          </div>
          {onDelete ? <button onClick={del} aria-label="Delete" style={circle}><svg width="20" height="22" viewBox="0 0 20 22" fill="none" stroke={T.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 5h16M7 5V3h6v2M4 5l1 14a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 15 19l1-14M8 9v8M12 9v8" /></svg></button>
            : <span style={{ width: 46 }} />}
        </div>
      </div>
    </div>,
    document.body
  );
}
