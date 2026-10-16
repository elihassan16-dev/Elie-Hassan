// 🎤 WhatsApp-style voice notes (Elie 10/16/26, approved mockup):
//   Phone — HOLD the mic to record, LET GO to send. Slide LEFT to throw it away,
//           slide UP to lock and keep talking hands-free (trash · ⏸ · send).
//           A quick tap just says "Hold to record".
//   Computer — click the mic: the locked bar opens right away.
// While recording, a bar covers the composer row (its parent must be
// position:relative). onDone(file, {dur, wave}) hands over the finished note;
// the composer sends it straight away (the upload runs in the background).
import { useEffect, useRef, useState } from "react";
import { T } from "./theme";
import { MicIcon } from "./icons";

const RED = "#FF3B30";
const coarse = () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const BARS = 40;

// Downsample the loudness samples into the bars stored on the note (0..1).
export function toWave(samples, n = BARS) {
  if (!samples.length) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * samples.length) / n), b = Math.max(a + 1, Math.floor(((i + 1) * samples.length) / n));
    let m = 0; for (let j = a; j < b && j < samples.length; j++) m = Math.max(m, samples[j]);
    out.push(m);
  }
  const top = Math.max(0.05, ...out);
  return out.map((v) => Math.round(Math.min(1, v / top) * 100) / 100);
}

function useRecorder() {
  const [state, setState] = useState("idle"); // idle | starting | rec | paused
  const [secs, setSecs] = useState(0);
  const [levels, setLevels] = useState([]);
  const r = useRef({});
  const cleanup = () => {
    const x = r.current;
    clearInterval(x.tick);
    try { x.stream && x.stream.getTracks().forEach((t) => t.stop()); } catch { /* gone */ }
    try { x.ctx && x.ctx.close(); } catch { /* gone */ }
    try { window.__gsRecording = false; } catch { /* no window */ }
    r.current = {};
    setState("idle"); setSecs(0); setLevels([]);
  };
  useEffect(() => () => { const x = r.current; if (x.mr && x.mr.state !== "inactive") { x.cancel = true; try { x.mr.stop(); } catch { /* */ } } cleanup(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    if (r.current.mr || state === "starting") return false;
    if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder === "undefined") throw new Error("Voice notes aren't supported on this device.");
    setState("starting");
    const x = { samples: [], chunks: [], ms: 0, last: 0 };
    r.current = x;
    // An AudioContext made inside the touch keeps iOS happy (live waveform).
    let ctx = null;
    try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) { ctx = new AC(); if (ctx.state === "suspended") ctx.resume(); } } catch { ctx = null; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { try { ctx && ctx.close(); } catch { /* */ } r.current = {}; setState("idle"); throw new Error("Microphone access is blocked — allow it in Settings to record."); }
    if (r.current !== x) { stream.getTracks().forEach((t) => t.stop()); return false; } // cancelled while asking
    const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || "";
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    mr.ondataavailable = (e) => { if (e.data && e.data.size) x.chunks.push(e.data); };
    x.stream = stream; x.mr = mr; x.ctx = ctx;
    if (ctx) {
      try {
        const an = ctx.createAnalyser(); an.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(an);
        x.an = an; x.buf = new Uint8Array(an.fftSize);
      } catch { x.an = null; }
    }
    mr.start(250);
    x.last = Date.now();
    try { window.__gsRecording = true; } catch { /* */ }
    setState("rec");
    x.tick = setInterval(() => {
      if (x.mr && x.mr.state === "recording") {
        x.ms += Date.now() - x.last; x.last = Date.now();
        let lvl = 0.15;
        if (x.an) { x.an.getByteTimeDomainData(x.buf); let sum = 0; for (const v of x.buf) { const d = (v - 128) / 128; sum += d * d; } lvl = Math.min(1, Math.sqrt(sum / x.buf.length) * 4); }
        x.samples.push(lvl);
        setLevels((p) => [...p.slice(-(BARS - 1)), lvl]);
        setSecs(x.ms / 1000);
        if (x.ms > 15 * 60 * 1000) x.mr.pause(); // 15-minute ceiling
      } else x.last = Date.now();
    }, 100);
    return true;
  };
  const pause = () => { const x = r.current; if (x.mr && x.mr.state === "recording") { x.mr.pause(); setState("paused"); } };
  const resume = () => { const x = r.current; if (x.mr && x.mr.state === "paused") { x.last = Date.now(); x.mr.resume(); setState("rec"); } };
  const cancel = () => {
    const x = r.current;
    x.cancel = true;
    if (x.mr && x.mr.state !== "inactive") { try { x.mr.stop(); } catch { /* */ } }
    cleanup();
  };
  // → {file, dur, wave} or null (nothing recorded)
  const finish = () => new Promise((resolve) => {
    const x = r.current;
    if (!x.mr || x.mr.state === "inactive") { cleanup(); resolve(null); return; }
    x.mr.onstop = () => {
      const type = x.mr.mimeType || "audio/webm";
      const blob = new Blob(x.chunks, { type });
      const dur = Math.max(1, Math.round(x.ms / 1000));
      const wave = toWave(x.samples);
      cleanup();
      if (!blob.size) { resolve(null); return; }
      const ext = /mp4|aac|m4a/.test(type) ? "m4a" : "webm";
      resolve({ file: new File([blob], `voice-note-${Date.now()}.${ext}`, { type: type.split(";")[0] }), dur, wave });
    };
    try { x.mr.stop(); } catch { cleanup(); resolve(null); }
  });
  return { state, secs, levels, start, pause, resume, cancel, finish };
}

function Wave({ levels, color = T.gold, height = 28 }) {
  const bars = [...Array(Math.max(0, BARS - levels.length)).fill(0.06), ...levels];
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 2, height, overflow: "hidden" }}>
      {bars.map((v, i) => <i key={i} style={{ display: "block", flex: "0 0 3px", width: 3, borderRadius: 2, height: Math.max(3, Math.round(v * height)), background: color }} />)}
    </div>
  );
}

const micSvg = (size, color = "#fff") => <MicIcon size={size} color={color} />;
// iOS-style trash (SF Symbols "trash" look) instead of the 🗑 emoji (Elie 10/16/26).
const TrashIcon = ({ size = 22, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
    <path d="M3.5 6h17" />
    <path d="M9 6V4.6c0-.9.7-1.6 1.6-1.6h2.8c.9 0 1.6.7 1.6 1.6V6" />
    <path d="M5.5 6l.9 13.1c.1 1.1 1 1.9 2.1 1.9h7c1.1 0 2-.8 2.1-1.9L18.5 6" />
    <path d="M10 10.5v6M14 10.5v6" />
  </svg>
);

// size: the idle button's diameter. gold: idle look = solid gold (WhatsApp's
// send-slot mic) vs. a quiet ghost icon (desktop toolbars).
export function VoiceRecorder({ onDone, onError, disabled, size = 38, gold = true, title = "Voice note" }) {
  const rec = useRecorder();
  const [mode, setMode] = useState("idle"); // idle | hold | locked
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [hint, setHint] = useState("");
  const g = useRef({});
  const flash = (t) => { setHint(t); clearTimeout(g.current.ht); g.current.ht = setTimeout(() => setHint(""), 2200); };
  useEffect(() => () => clearTimeout(g.current.ht), []);
  const fail = (e) => { setMode("idle"); if (onError) onError(e.message || String(e)); else flash(e.message || "Couldn't record."); };

  const send = async () => {
    setMode("idle"); setDrag({ x: 0, y: 0 });
    const out = await rec.finish();
    if (!out) return;
    if (out.dur < 1) { flash("Too short — hold the mic while you talk"); return; }
    try { await onDone(out.file, { dur: out.dur, wave: out.wave }); } catch (e) { fail(e); }
  };
  const cancel = (why) => { rec.cancel(); setMode("idle"); setDrag({ x: 0, y: 0 }); if (why) flash(why); };

  // ── phone: press-and-hold ────────────────────────────────────────────────
  const onPointerDown = (e) => {
    if (disabled) return;
    if (e.pointerType === "mouse" || !coarse()) return; // desktop uses click
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ }
    g.current = { ...g.current, sx: e.clientX, sy: e.clientY, t0: Date.now(), up: false };
    setMode("hold"); setDrag({ x: 0, y: 0 });
    try { navigator.vibrate && navigator.vibrate(12); } catch { /* */ }
    rec.start().then((ok) => {
      // Let go while the phone was still asking for the microphone → nothing to send.
      if (ok && g.current.up && g.current.modeAtUp !== "locked") { rec.cancel(); setMode("idle"); flash("Mic ready — hold the button and talk"); }
    }).catch(fail);
  };
  const onPointerMove = (e) => {
    if (mode !== "hold") return;
    const dx = Math.min(0, e.clientX - g.current.sx), dy = Math.min(0, e.clientY - g.current.sy);
    setDrag({ x: dx, y: dy });
    if (dx < -110) cancel("Voice note deleted");
    else if (dy < -80) { setMode("locked"); setDrag({ x: 0, y: 0 }); try { navigator.vibrate && navigator.vibrate(10); } catch { /* */ } }
  };
  const onPointerUp = () => {
    g.current.up = true; g.current.modeAtUp = mode;
    if (mode !== "hold") return;
    if (Date.now() - g.current.t0 < 450) { cancel("Hold to record, let go to send"); return; }
    if (rec.state === "starting") return; // handled when start resolves
    send();
  };
  // ── computer: click → locked bar ─────────────────────────────────────────
  const onClick = () => {
    if (disabled || coarse()) return;
    if (mode !== "idle") return;
    setMode("locked");
    rec.start().catch(fail);
  };

  const active = mode !== "idle";
  const paused = rec.state === "paused";
  const dot = <span style={{ width: 10, height: 10, borderRadius: "50%", background: RED, flexShrink: 0, opacity: paused ? 0.4 : 1, boxShadow: paused ? "none" : "0 0 0 4px rgba(255,59,48,0.18)" }} />;
  const timer = <b style={{ fontSize: 16, fontVariantNumeric: "tabular-nums", color: T.text, flexShrink: 0 }}>{fmt(rec.secs)}</b>;
  const circ = { width: 44, height: 44, borderRadius: "50%", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, padding: 0, fontFamily: "inherit" };

  return (<>
    {/* the mic itself (grows under the finger while held) */}
    <button type="button" aria-label={title} title={coarse() ? "Hold to record, let go to send" : title} disabled={disabled}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onClick={onClick}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0, padding: 0, fontFamily: "inherit", touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none",
        display: mode === "locked" ? "none" : "flex", alignItems: "center", justifyContent: "center", cursor: disabled ? "default" : "pointer",
        border: gold ? "none" : `1px solid ${T.border}`, background: gold ? T.gold : T.bg, color: gold ? "#fff" : T.textSub,
        boxShadow: mode === "hold" ? "0 0 0 10px rgba(184,149,63,0.18)" : gold ? "0 2px 8px rgba(184,149,63,0.35)" : "none",
        transform: mode === "hold" ? `translate(${Math.max(drag.x, -60) * 0.25}px, ${drag.y * 0.5}px) scale(1.55)` : "none",
        transition: mode === "hold" ? "box-shadow .15s" : "transform .15s", position: "relative", zIndex: 3,
      }}>{micSvg(Math.round(size * 0.5), gold ? "#fff" : T.textSub)}</button>

    {hint && !active && <div style={{ position: "absolute", right: 4, bottom: "calc(100% + 8px)", zIndex: 5, background: "#1C1C1E", color: "#fff", fontSize: 12, fontWeight: 600, padding: "6px 10px", borderRadius: 10, whiteSpace: "nowrap", pointerEvents: "none" }}>{hint}</div>}

    {mode === "hold" && (<>
      {/* bar under the finger: timer + "slide to cancel" */}
      <div style={{ position: "absolute", inset: 0, zIndex: 2, background: "#fff", borderRadius: 22, display: "flex", alignItems: "center", gap: 10, padding: "0 70px 0 12px", pointerEvents: "none" }}>
        {dot}{timer}
        <span style={{ flex: 1, textAlign: "center", color: T.textSub, fontSize: 14, transform: `translateX(${Math.max(drag.x, -110) * 0.6}px)`, opacity: 1 + drag.x / 160, whiteSpace: "nowrap" }}>‹ Slide to cancel</span>
      </div>
      {/* lock pill above the mic */}
      <div style={{ position: "absolute", right: 0, bottom: `calc(100% + ${16 - drag.y * 0.4}px)`, zIndex: 4, width: 42, height: 88, borderRadius: 21, background: "#fff", boxShadow: "0 2px 12px rgba(0,0,0,0.16)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", padding: "11px 0", pointerEvents: "none" }}>
        <svg width="16" height="19" viewBox="0 0 18 20"><rect x="2" y="9" width="14" height="10" rx="2.5" fill={drag.y < -40 ? T.gold : "#6E6E73"} /><path d="M5 9V6a4 4 0 0 1 8 0v3" stroke={drag.y < -40 ? T.gold : "#6E6E73"} strokeWidth="2" fill="none" /></svg>
        <span style={{ color: "#8E8E93", fontSize: 15, lineHeight: 1 }}>⌃</span>
      </div>
    </>)}

    {mode === "locked" && (
      <div style={{ position: "absolute", inset: 0, zIndex: 4, background: "#fff", borderRadius: 22, display: "flex", alignItems: "center", gap: 10, padding: "0 4px 0 6px", boxShadow: "0 0 0 1px rgba(0,0,0,0.06)" }}>
        <button type="button" onClick={() => cancel("")} aria-label="Delete the voice note" style={{ ...circ, background: "none", color: T.textSub }}><TrashIcon /></button>
        {dot}{timer}
        <Wave levels={rec.levels} color={paused ? "#C7C7CC" : T.gold} />
        <button type="button" onClick={() => (paused ? rec.resume() : rec.pause())} aria-label={paused ? "Keep recording" : "Pause"} disabled={rec.state === "starting"}
          style={{ ...circ, width: 38, height: 38, background: "none", border: `2px solid ${RED}`, color: RED }}>
          {paused ? micSvg(17, RED) : <span style={{ display: "flex", gap: 4 }}><i style={{ width: 4, height: 13, background: RED, borderRadius: 1 }} /><i style={{ width: 4, height: 13, background: RED, borderRadius: 1 }} /></span>}
        </button>
        <button type="button" onClick={send} aria-label="Send the voice note" disabled={rec.state === "starting"} style={{ ...circ, background: T.gold, boxShadow: "0 2px 8px rgba(184,149,63,0.35)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24"><path d="M4 12l15-8-5 17-3-7z" fill="#fff" /></svg>
        </button>
      </div>
    )}
  </>);
}
