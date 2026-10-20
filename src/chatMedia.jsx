// WhatsApp-style chat pieces (Elie 10/16/26, approved mockup) shared by every
// chat — team property/task/office chats, the contractor job chat on the admin
// side, and the contractor portal:
//   • MediaBubble — photos in their real shape (no cropping), WhatsApp photo
//     grids, phone videos standing up with ▶ + length, voice notes with a play
//     button / waveform / 1×·1.5×·2×, and the sender's own uploads showing
//     instantly with a progress ring (✕ failed → Try again).
//   • MediaViewer — full-screen inside the app: swipe between photos, pinch or
//     double-tap to zoom, swipe down to close, ⬇ Save / ⤴ Share.
//   • SwipeReply — swipe a message to the right to reply to it.
//   • MentionText — tagged people's @names show IN the message.
import { useEffect, useRef, useState } from "react";
import { T } from "./theme";
import { linkifyText } from "./sms";
import { FileActions } from "./fileActions";
import { PhotoViewer } from "./photoViewer";
import { useVideoUpload, VideoUploadBubble, localPreview, retryUpload } from "./videoUpload";

const GOLD_DARK = "#8a6d1f";
const vw = () => (typeof window !== "undefined" ? window.innerWidth : 400);
const maxW = () => Math.min(250, Math.round(vw() * 0.64));
const dimCache = new Map(); // url → {w,h} once a picture has loaded

function fitBox(w, h, mw, mh) {
  const r = w / h;
  let W = mw, H = mw / r;
  if (H > mh) { H = mh; W = mh * r; }
  return { W: Math.max(110, Math.round(W)), H: Math.max(80, Math.round(H)) };
}

// Cloudflare Stream: the poster frame for a video (also for older messages that
// never stored one).
export function streamThumb(att) {
  if (!att) return "";
  if (att.thumbnail) return att.thumbnail;
  const m = /^(https:\/\/[^/]+)\/([a-f0-9]{20,})\//i.exec(att.url || att.watch || "");
  return m ? `${m[1]}/${m[2]}/thumbnails/thumbnail.jpg?time=1s&height=600` : "";
}
const fmtDur = (s) => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// One picture box in its own shape. Known size → laid out before it loads.
function Photo({ src, w, h, onOpen, mw, mh = 320, dim = false, children }) {
  const [d, setD] = useState(() => (w && h ? { w, h } : dimCache.get(src) || null));
  const box = d ? fitBox(d.w, d.h, mw, mh) : { W: Math.min(220, mw), H: Math.min(220, mh) };
  return (
    <div onClick={onOpen} style={{ position: "relative", width: box.W, height: box.H, borderRadius: 14, overflow: "hidden", background: "#E5E5EA", cursor: onOpen ? "pointer" : "default", marginTop: 6 }}>
      {src && <img src={src} alt="" loading="lazy" decoding="async" draggable={false}
        onLoad={(e) => { const n = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }; if (n.w && n.h) { dimCache.set(src, n); if (!d) setD(n); } }}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", filter: dim ? "brightness(0.72)" : "none" }} />}
      {children}
    </div>
  );
}

function Ring({ pct, size = 54 }) {
  const r = size / 2 - 4, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="rgba(0,0,0,0.38)" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="3.5" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0.04, (pct || 0) / 100))} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: "stroke-dashoffset .3s" }} />
    </svg>
  );
}
const playIcon = (size = 52) => (
  <span style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: size, height: size, borderRadius: "50%", background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
    <span style={{ borderLeft: `${Math.round(size * 0.33)}px solid #fff`, borderTop: `${Math.round(size * 0.2)}px solid transparent`, borderBottom: `${Math.round(size * 0.2)}px solid transparent`, marginLeft: Math.round(size * 0.1) }} />
  </span>
);

// WhatsApp grid: 2 side by side, 3 = one wide + two, 4+ = 2×2 with "+N".
function Grid({ items, srcOf, onOpen }) {
  const W = maxW(), half = Math.floor((W - 3) / 2), n = items.length, shown = items.slice(0, 4);
  return (
    <div style={{ display: "grid", gridTemplateColumns: `${half}px ${half}px`, gap: 3, width: half * 2 + 3, borderRadius: 14, overflow: "hidden", marginTop: 6 }}>
      {shown.map((it, i) => {
        const wide = n === 3 && i === 0;
        return (
          <div key={i} onClick={onOpen ? () => onOpen(i) : undefined} style={{ position: "relative", gridColumn: wide ? "1 / span 2" : undefined, height: wide ? Math.round(half * 1.1) : half, background: "#E5E5EA", cursor: onOpen ? "pointer" : "default", overflow: "hidden" }}>
            {srcOf(it, i) && <img src={srcOf(it, i)} alt="" loading="lazy" decoding="async" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
            {i === 3 && n > 4 && <span style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: 26, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>+{n - 4}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── 🎤 voice note player ──────────────────────────────────────────────────────
let nowPlaying = null;
const seeded = (key, n = 40) => { let h = 7; for (const ch of String(key || "x")) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return Array.from({ length: n }, () => { h = (h * 1103515245 + 12345) >>> 0; return 0.25 + ((h >>> 8) % 1000) / 1400; }); };
export function VoiceBubble({ att, mine, sending = false, pct = 0 }) {
  const a = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(att.dur || 0);
  const [rate, setRate] = useState(1);
  const [bad, setBad] = useState(false);
  const bars = att.wave && att.wave.length && Math.max(...att.wave) > 0.05 ? att.wave : seeded(att.url || att.name || att.uploadId);
  const prog = dur ? Math.min(1, t / dur) : 0;
  const toggle = () => {
    const el = a.current; if (!el || sending) return;
    if (!el.paused) { el.pause(); return; }
    if (nowPlaying && nowPlaying !== el) { try { nowPlaying.pause(); } catch { /* gone */ } }
    nowPlaying = el; el.playbackRate = rate;
    el.play().catch(() => setBad(true));
  };
  const seek = (e) => {
    const el = a.current; if (!el || !dur || sending) return;
    const r = e.currentTarget.getBoundingClientRect();
    el.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur; setT(el.currentTime);
  };
  const nextRate = () => { const r = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1; setRate(r); if (a.current) a.current.playbackRate = r; };
  const fg = mine ? "#fff" : T.gold, rest = mine ? "rgba(255,255,255,0.45)" : "#C7C7CC";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, width: "min(250px,62vw)", marginTop: 2 }}>
      {att.url && <audio ref={a} src={att.url} preload="metadata"
        onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (isFinite(d) && d > 0 && !att.dur) setDur(d); }}
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setT(0); }} onError={() => setBad(true)} />}
      <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play voice note"} style={{ position: "relative", width: 40, height: 40, borderRadius: "50%", border: "none", flexShrink: 0, cursor: sending ? "default" : "pointer", background: mine ? "#fff" : T.gold, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
        {sending ? <span style={{ width: 16, height: 16, borderRadius: "50%", border: `2.5px solid ${mine ? T.gold : "#fff"}`, borderTopColor: "transparent", animation: "gsSpin 0.9s linear infinite" }} />
          : playing ? <span style={{ display: "flex", gap: 4 }}><i style={{ width: 4, height: 14, background: mine ? T.gold : "#fff", borderRadius: 1 }} /><i style={{ width: 4, height: 14, background: mine ? T.gold : "#fff", borderRadius: 1 }} /></span>
          : <span style={{ borderLeft: `13px solid ${mine ? T.gold : "#fff"}`, borderTop: "8px solid transparent", borderBottom: "8px solid transparent", marginLeft: 3 }} />}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div onClick={seek} style={{ display: "flex", alignItems: "center", gap: 2, height: 28, cursor: dur ? "pointer" : "default" }}>
          {bars.map((v, i) => <i key={i} style={{ display: "block", flex: 1, minWidth: 2, maxWidth: 3, borderRadius: 2, height: Math.max(3, Math.round(v * 26)), background: (i + 0.5) / bars.length <= (sending ? pct / 100 : prog) ? fg : rest }} />)}
        </div>
        <div style={{ fontSize: 11, color: mine ? "rgba(255,255,255,0.88)" : T.textSub, marginTop: 1 }}>
          {bad ? "Can't play here — use ⬇ Save" : sending ? "Sending…" : playing || t > 0 ? `${fmtDur(t)} / ${fmtDur(dur)}` : fmtDur(dur)}
        </div>
      </div>
      {(playing || t > 0) && !sending && <button type="button" onClick={nextRate} style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, padding: "4px 8px", borderRadius: 10, border: "none", background: mine ? "rgba(255,255,255,0.22)" : "rgba(118,118,128,0.12)", color: mine ? "#fff" : T.textSub, cursor: "pointer", fontFamily: "inherit" }}>{rate}×</button>}
    </div>
  );
}

// ── the sender's upload, or "on its way" for everyone else ───────────────────
function PendingMedia({ att, mine }) {
  const live = useVideoUpload(att.uploadId);
  const stale = !live && att.pending && att.startedAt && Date.now() - new Date(att.startedAt).getTime() > 45 * 60000;
  const failed = att.failed || (live && live.status === "failed") || stale;
  const pct = live ? live.pct || 0 : 0;
  const canRetry = failed && !!live;
  const sub = mine ? "rgba(255,255,255,0.88)" : T.textSub;
  const status = (
    <div style={{ fontSize: 11, color: failed ? (mine ? "#fff" : T.red) : sub, marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
      <span>{failed ? "⚠️ Didn't upload" : live ? `Sending… ${pct}%` : "On its way…"}</span>
      {canRetry && <button type="button" onClick={() => retryUpload(att.uploadId)} style={{ border: "none", borderRadius: 10, padding: "3px 9px", fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", background: mine ? "rgba(255,255,255,0.25)" : T.goldLight, color: mine ? "#fff" : GOLD_DARK }}>Try again</button>}
    </div>
  );
  const ring = !failed && live ? <Ring pct={pct} /> : failed ? <span style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", fontSize: 30 }}>⚠️</span> : null;
  if (att.kind === "images") {
    const items = att.items || [];
    return <div><div style={{ position: "relative", width: "fit-content" }}><Grid items={items} srcOf={(it, i) => localPreview(att.uploadId, i)} />{ring}</div>{status}</div>;
  }
  if (att.kind === "image") {
    return <div><Photo src={localPreview(att.uploadId)} w={att.w} h={att.h} mw={maxW()} dim>{ring}{!localPreview(att.uploadId) && !failed && <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: T.textSub }}>📷</span>}</Photo>{status}</div>;
  }
  if (att.kind === "audio") {
    return <div><VoiceBubble att={att} mine={mine} sending={!failed} pct={pct} />{failed && status}</div>;
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, padding: "8px 10px", borderRadius: 12, background: mine ? "rgba(255,255,255,0.16)" : T.bg, maxWidth: 250 }}>
      <span style={{ fontSize: 20 }}>📄</span>
      <div style={{ minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{att.name || "File"}</div>{status}</div>
    </div>
  );
}

// ── the bubble content for any attachment ────────────────────────────────────
// extra: more chips next to ⬇ Save / ⤴ Share (e.g. 💾 Save to Files).
export function MediaBubble({ att: given, mine, extra = null }) {
  const [open, setOpen] = useState(null);
  // On the sender's device a finished upload shows right away, without
  // waiting for the saved message to be patched and synced back.
  const live = useVideoUpload(given && given.pending ? given.uploadId : null);
  const att = given && given.pending && live && live.status === "done" && live.att ? live.att : given;
  if (!att) return null;
  if (att.pending || att.failed) return att.kind === "video" ? <VideoUploadBubble att={att} mine={mine} /> : <PendingMedia att={att} mine={mine} />;
  if (!att.url) return null;
  const acts = (item) => <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 5 }}><FileActions item={item} mine={mine} />{extra}</div>;
  const viewer = (items) => open != null && <MediaViewer items={items} index={open} onClose={() => setOpen(null)} />;
  if (att.kind === "images" && Array.isArray(att.items)) {
    const items = att.items.map((it) => ({ ...it, kind: "image" }));
    return <div><Grid items={items} srcOf={(it) => it.url} onOpen={(i) => setOpen(i)} />{acts(att)}{viewer(items)}</div>;
  }
  if (att.kind === "image") return <div><Photo src={att.url} w={att.w} h={att.h} mw={maxW()} onOpen={() => setOpen(0)} />{acts(att)}{viewer([att])}</div>;
  if (att.kind === "video") {
    const thumb = att.stream ? streamThumb(att) : "";
    // Before Cloudflare tells us the size, assume a phone video (standing up).
    const w = att.w || (thumb ? 0 : 9), h = att.h || (thumb ? 0 : 16);
    return (
      <div>
        {thumb
          ? <Photo src={thumb} w={w} h={h} mw={maxW()} mh={340} onOpen={() => setOpen(0)}>{playIcon()}{att.dur ? <span style={{ position: "absolute", left: 8, bottom: 7, color: "#fff", fontSize: 11.5, fontWeight: 700, textShadow: "0 1px 3px rgba(0,0,0,0.6)" }}>🎥 {fmtDur(att.dur)}</span> : null}</Photo>
          : <VideoFrame att={att} onOpen={() => setOpen(0)} />}
        {(!att.stream || att.uid) && acts(att)}
        {viewer([att])}
      </div>
    );
  }
  if (att.kind === "audio") return <VoiceBubble att={att} mine={mine} />;
  return (
    <div>
      <a href={att.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, padding: "9px 11px", borderRadius: 12, background: mine ? "rgba(255,255,255,0.16)" : T.bg, textDecoration: "none", color: mine ? "#fff" : T.text, maxWidth: 250 }}>
        <span style={{ fontSize: 20, flexShrink: 0 }}>{/pdf/i.test(att.mime || att.name || "") ? "📕" : "📄"}</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{att.name || "Attachment"}</span>
      </a>
      {acts(att)}
    </div>
  );
}

// A plain (non-Stream) video: its first frame, in its own shape.
function VideoFrame({ att, onOpen }) {
  const [d, setD] = useState(att.w && att.h ? { w: att.w, h: att.h } : dimCache.get(att.url) || null);
  const box = d ? fitBox(d.w, d.h, maxW(), 340) : { W: Math.min(200, maxW()), H: 260 };
  return (
    <div onClick={onOpen} style={{ position: "relative", width: box.W, height: box.H, borderRadius: 14, overflow: "hidden", background: "#000", marginTop: 6, cursor: "pointer" }}>
      <video src={`${att.url}#t=0.1`} muted playsInline preload="metadata" onLoadedMetadata={(e) => { const n = { w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight }; if (n.w && n.h) { dimCache.set(att.url, n); setD(n); } }} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }} />
      {playIcon()}
    </div>
  );
}

// ── full-screen viewer ───────────────────────────────────────────────────────
// The app-wide iPhone-Photos viewer (photoViewer.jsx); chat attachments map in.
export function MediaViewer({ items, index = 0, onClose }) {
  const list = items.map((it, i) => ({
    key: `${it.url || ""}#${i}`, kind: it.kind === "video" ? "video" : "image", name: it.name || "",
    url: it.kind === "video" && it.stream ? (it.watch || "") : it.url,
    embed: it.kind === "video" && it.stream ? `${it.url}${String(it.url).includes("?") ? "&" : "?"}autoplay=true` : null,
    thumb: it.kind === "video" && it.stream ? streamThumb(it) : null,
    file: it, title: it.kind === "video" ? "Video" : "Photo", sub: it.name || "",
  }));
  return <PhotoViewer items={list} index={index} onClose={onClose} />;
}

// ── swipe right to reply ─────────────────────────────────────────────────────
// align: "flex-start" | "flex-end" — how the message sits in its row.
export function SwipeReply({ onReply, disabled, align = "flex-start", style, children, ...rest }) {
  const st = useRef(null);
  const [dx, setDx] = useState(0);
  if (disabled || !onReply) return <div {...rest} style={{ display: "flex", flexDirection: "column", alignItems: align, ...style }}>{children}</div>;
  const start = (e) => { if (e.touches.length !== 1) { st.current = null; return; } const t = e.touches[0]; st.current = { x: t.clientX, y: t.clientY, axis: null, armed: false }; };
  const moveT = (e) => {
    const s = st.current; if (!s) return;
    const t = e.touches[0], mx = t.clientX - s.x, my = t.clientY - s.y;
    if (!s.axis) { if (Math.abs(mx) < 8 && Math.abs(my) < 8) return; s.axis = mx > 0 && Math.abs(mx) > Math.abs(my) * 1.3 ? "x" : "y"; }
    if (s.axis !== "x") return;
    const d = Math.max(0, Math.min(90, mx * 0.75));
    if (d >= 60 && !s.armed) { s.armed = true; try { navigator.vibrate && navigator.vibrate(10); } catch { /* */ } }
    if (d < 60) s.armed = false;
    setDx(d);
  };
  const end = () => { const s = st.current; st.current = null; if (s && s.axis === "x" && s.armed) onReply(); setDx(0); };
  return (
    <div {...rest} onTouchStart={start} onTouchMove={moveT} onTouchEnd={end} onTouchCancel={end}
      style={{ position: "relative", touchAction: "pan-y", display: "flex", flexDirection: "column", alignItems: align, ...style }}>
      <span aria-hidden="true" style={{ position: "absolute", left: 0, top: "50%", width: 30, height: 30, borderRadius: "50%", background: "rgba(118,118,128,0.14)", color: GOLD_DARK, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, transform: `translate(${Math.min(dx, 60) / 2 - 34}px,-50%) scale(${0.6 + Math.min(1, dx / 60) * 0.4})`, opacity: Math.min(1, dx / 50), pointerEvents: "none" }}>↩</span>
      <div style={{ transform: `translateX(${dx}px)`, transition: st.current ? "none" : "transform .2s", display: "flex", flexDirection: "column", alignItems: align, maxWidth: "100%" }}>{children}</div>
    </div>
  );
}

// ── @names in the message ────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// replyAuthor: a reply already names who it answers — no extra @ for them.
export function MentionText({ text, mentions, mine, replyAuthor }) {
  const s = String(text ?? "");
  const names = [...new Set((mentions || []).filter(Boolean).map(String))];
  if (!names.length) return linkifyText(s, mine);
  const ppl = names.map((n) => ({ n, f: n.split(" ")[0] }));
  const tagStyle = { fontWeight: 750, borderRadius: 5, padding: "0 3px", background: mine ? "rgba(255,255,255,0.24)" : "rgba(184,149,63,0.15)", color: mine ? "#fff" : GOLD_DARK, whiteSpace: "nowrap" };
  const alts = ppl.flatMap((x) => [x.n, x.f]).filter(Boolean).sort((a, b) => b.length - a.length).map(esc).join("|");
  const rx = new RegExp(`@(${alts})(?![\\w])`, "gi");
  const inText = new Set();
  for (const m of s.matchAll(rx)) { const hit = ppl.find((x) => x.n.toLowerCase() === m[1].toLowerCase() || x.f.toLowerCase() === m[1].toLowerCase()); if (hit) inText.add(hit.n); }
  const missing = ppl.filter((x) => !inText.has(x.n) && x.n !== replyAuthor);
  const parts = [];
  let last = 0, k = 0;
  for (const m of s.matchAll(rx)) {
    if (m.index > last) parts.push(<span key={k++}>{linkifyText(s.slice(last, m.index), mine)}</span>);
    parts.push(<span key={k++} style={tagStyle}>@{m[1]}</span>);
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push(<span key={k++}>{linkifyText(s.slice(last), mine)}</span>);
  return (<>
    {missing.map((x) => <span key={"m" + x.n}><span style={tagStyle}>@{x.f}</span>{" "}</span>)}
    {parts}
  </>);
}
