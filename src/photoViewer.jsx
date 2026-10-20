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
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { T } from "./theme";
import { saveItem, shareItem, isPhone } from "./fileSave";

const vw = () => (typeof window !== "undefined" ? window.innerWidth : 400);
const fmtWhen = (t) => { try { const d = new Date(t); if (isNaN(d)) return ""; const today = new Date(); const y = new Date(Date.now() - 86400000); const same = (a, b) => a.toDateString() === b.toDateString(); const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); return same(d, today) ? `Today ${time}` : same(d, y) ? `Yesterday ${time}` : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) })} ${time}`; } catch { return ""; } };
export const viewerWhen = fmtWhen;

// Photos never take the touch themselves (pointer-events off, no iOS
// callout), so a swipe that starts ANYWHERE on the screen is ours. Videos show
// their poster + a big ▶ until tapped — only then does the player get touches.
const noTouch = { pointerEvents: "none", WebkitTouchCallout: "none", userSelect: "none", WebkitUserSelect: "none" };
function Slide({ it, active, playing, onPlay }) {
  if (!it) return null;
  if (it.kind === "image") return <img src={it.url} alt={it.name || "photo"} draggable={false} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block", ...noTouch }} />;
  if (!active || !playing) return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#000" }}>
      {it.thumb ? <img src={it.thumb} alt="" draggable={false} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block", ...noTouch }} /> : <div style={{ width: "70%", aspectRatio: "16/9", background: "#111", borderRadius: 8 }} />}
      {active && <button data-pv-btn onClick={onPlay} aria-label="Play video" style={{ position: "absolute", width: 76, height: 76, borderRadius: 38, border: "none", background: "rgba(255,255,255,0.92)", boxShadow: "0 4px 20px rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}>
        <svg width="30" height="34" viewBox="0 0 30 34"><path d="M4 2.5v29a1.5 1.5 0 0 0 2.3 1.3l23-14.5a1.5 1.5 0 0 0 0-2.6L6.3 1.2A1.5 1.5 0 0 0 4 2.5Z" fill="#1C1C1E" /></svg>
      </button>}
    </div>
  );
  if (it.embed) { const src = /autoplay=/.test(it.embed) ? it.embed : `${it.embed}${it.embed.includes("?") ? "&" : "?"}autoplay=true`; return <iframe key={it.key} src={src} title={it.name || "video"} allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none", background: "#000" }} />; }
  if (!it.url) return <div style={{ color: "#fff", fontSize: 15 }}>Still processing…</div>;
  return <video key={it.key} src={it.url} controls playsInline autoPlay style={{ maxWidth: "100%", maxHeight: "100%", display: "block", background: "#000" }} />;
}

export function PhotoViewer({ items, index = 0, onClose, actions, onDelete, deleteConfirm }) {
  const n = items.length;
  const [idx, setIdx] = useState(Math.max(0, Math.min(index, n - 1)));
  const [scale, setScale] = useState(1), [tx, setTx] = useState(0), [ty, setTy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [playKey, setPlayKey] = useState(null); // the video whose player is live
  const [chrome, setChrome] = useState(true);
  const [menu, setMenu] = useState(false);
  const [status, setStatus] = useState("");
  const boxRef = useRef(null), stripRef = useRef(null), trackRef = useRef(null), rootRef = useRef(null);
  const st = useRef({}); st.current = { s: scale, tx, ty, idx, n };
  const g = useRef({ mode: null });
  const nav = useRef({});
  const x = items[idx];
  // The swipe track is moved straight on the DOM (no React render per finger
  // move) so it sticks to the finger; a committed swipe slides the neighbour
  // all the way in, then the index flips and the track snaps back to 0.
  const setTrack = (x, y, ms) => {
    const t = trackRef.current; if (!t) return;
    t.style.transition = ms ? `transform ${ms}ms cubic-bezier(.22,.8,.3,1)` : "none";
    t.style.transform = `translate3d(${x}px,${y}px,0) scale(${y > 0 ? Math.max(0.8, 1 - y / 1500) : 1})`;
  };
  const busy = useRef(false);
  const slideTo = (d, ms = 240) => {
    const { idx: i, n: N } = st.current;
    if (busy.current || i + d < 0 || i + d > N - 1) { setTrack(0, 0, 200); return; }
    const W = boxRef.current ? boxRef.current.clientWidth : vw();
    busy.current = true;
    setTrack(-d * (W + 16), 0, ms);
    setTimeout(() => { setIdx((v) => Math.max(0, Math.min(st.current.n - 1, v + d))); busy.current = false; }, ms);
  };
  nav.current = {
    go: (d) => slideTo(d),
    close: onClose,
    toggle: () => setChrome((c) => !c),
  };
  useLayoutEffect(() => { setTrack(0, 0, 0); }, [idx]); // the new current sits in the middle
  useEffect(() => { if (idx > n - 1) setIdx(Math.max(0, n - 1)); }, [n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!n) onClose(); }, [n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setScale(1); setTx(0); setTy(0); setStatus(""); setMenu(false); setPlayKey(null); }, [idx]);
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
        // onBtn: started on the ▶ button — still swipeable, but a plain tap is the button's.
        g.current = { mode: st.current.s > 1 ? "pan" : "swipe", last: p, startP: p, startT: Date.now(), moved: false, axis: null, hist: [{ x: p.x, y: p.y, t: performance.now() }], onBtn: !!(e.target.closest && e.target.closest("[data-pv-btn]")) };
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
        if (!G.axis && Math.hypot(mx, my) > 6) G.axis = Math.abs(mx) >= Math.abs(my) * 0.8 ? "x" : "y";
        G.hist.push({ x: p.x, y: p.y, t: performance.now() }); if (G.hist.length > 6) G.hist.shift();
        if (G.axis) {
          if (!G.moved) { G.moved = true; setDragging(true); }
          const { idx: i, n: N } = st.current;
          if (G.axis === "x") setTrack((i === 0 && mx > 0) || (i === N - 1 && mx < 0) ? mx / 3 : mx, 0, 0);
          else { const y = Math.max(0, my); setTrack(0, y, 0); const r = rootRef.current; if (r) r.style.background = `rgba(${st.current.dark ? "0,0,0" : "255,255,255"},${Math.max(0.3, 1 - y / 400)})`; }
        }
      }
    };
    const end = (e) => {
      const G = g.current;
      if (G.mode === "swipe" && e.changedTouches.length === 1 && st.current.s === 1) {
        const p = pt(e.changedTouches[0]);
        const mx = p.x - G.startP.x, my = p.y - G.startP.y;
        // Flick speed from the last ~80ms of movement (px per ms).
        const now = performance.now(), h = G.hist || [];
        const ref = h.find((q) => now - q.t < 90) || h[h.length - 1] || { x: p.x, y: p.y, t: now };
        const dt = Math.max(1, now - ref.t), vx = (p.x - ref.x) / dt, vy = (p.y - ref.y) / dt;
        if (G.moved) setDragging(false);
        const r = rootRef.current; if (r) r.style.background = st.current.bgFull;
        if (G.axis === "x") {
          const d = mx < 0 ? 1 : -1;
          const flick = Math.abs(vx) > 0.2 && Math.sign(vx) === Math.sign(mx);
          if (Math.abs(mx) > el.clientWidth * 0.12 || (flick && Math.abs(mx) > 10)) slideTo(d, Math.round(Math.max(140, Math.min(260, (el.clientWidth - Math.abs(mx)) / Math.max(0.9, Math.abs(vx))))));
          else setTrack(0, 0, 200);
        } else if (G.axis === "y") {
          if (my > 110 || (vy > 0.6 && my > 30)) nav.current.close(); else setTrack(0, 0, 200);
        } else if (!G.moved && !G.onBtn) {
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
    // Computers: a two-finger trackpad swipe sideways flips too (arrows + keys also work).
    let acc = 0, accT = 0, lockT = 0;
    const wheel = (e) => {
      if (st.current.s > 1 || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      const now = Date.now();
      if (now < lockT) return;
      if (now - accT > 250) acc = 0;
      acc += e.deltaX; accT = now;
      if (Math.abs(acc) > 60) { slideTo(acc > 0 ? 1 : -1); acc = 0; lockT = now + 450; }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("touchstart", start, { passive: false });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end, { passive: false });
    el.addEventListener("touchcancel", end, { passive: false });
    return () => { el.removeEventListener("touchstart", start); el.removeEventListener("touchmove", move); el.removeEventListener("touchend", end); el.removeEventListener("touchcancel", end); el.removeEventListener("wheel", wheel); };
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
  const bg = dark ? "#000" : "#fff";
  st.current.dark = dark; st.current.bgFull = bg;
  const W = boxRef.current ? boxRef.current.clientWidth : vw();
  const circle = { width: 46, height: 46, borderRadius: 23, border: "none", background: "rgba(255,255,255,0.92)", boxShadow: "0 2px 12px rgba(0,0,0,0.12), 0 0 0 0.5px rgba(0,0,0,0.06)", color: T.text, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontFamily: "inherit", flexShrink: 0, padding: 0 };
  const showChrome = chrome && !dragging && scale === 1;
  const zoomT = `translate(${tx}px,${ty}px) scale(${scale})`;
  const title = x.title || (x.kind === "video" ? "Video" : "Photo");
  const sub = x.sub != null ? x.sub : fmtWhen(x.at);
  return createPortal(
    <div ref={rootRef} onClick={(e) => e.stopPropagation()} style={{ position: "fixed", inset: 0, zIndex: 2600, background: bg, transition: dragging ? "none" : "background .2s", display: "flex", flexDirection: "column", overscrollBehavior: "contain" }}>
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
        <div ref={trackRef} style={{ position: "absolute", inset: 0, willChange: "transform" }}>
          {[-1, 0, 1].map((o) => {
            const it = items[idx + o];
            return (
              <div key={it ? it.key : `e${o}`} style={{ position: "absolute", top: 0, bottom: 0, left: o * (W + 16), width: W, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {it && (o === 0 && it.kind === "image"
                  ? <div style={{ position: "absolute", inset: 0, transform: zoomT, transformOrigin: "0 0", display: "flex", alignItems: "center", justifyContent: "center", transition: g.current.mode ? "none" : "transform .2s" }}><Slide it={it} active /></div>
                  : <Slide it={it} active={o === 0} playing={o === 0 && playKey === it.key} onPlay={() => setPlayKey(it.key)} />)}
              </div>
            );
          })}
        </div>
        {/* A playing video's player eats touches — its edges stay swipeable. */}
        {x.kind === "video" && playKey === x.key && <>
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
