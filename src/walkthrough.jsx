// 🎥 Walkthrough → AI punch list. Record a narrated walkthrough (or upload one
// from the camera roll), transcribe it with timestamps (Cloudflare Whisper via
// /api/ai/transcribe), turn the narration into room-grouped punch items
// (/api/ai/walkthrough), grab the video frame where each item was said, and
// hand off a branded PDF — download, share, or email to the contractor.
//
// The audio pipeline is uniform for recorded AND uploaded video: decode the
// file's audio in-browser, resample to 16 kHz mono, and send it in ~2.5-minute
// WAV chunks (each ~5 MB base64 — inside the endpoint's body limit), offsetting
// each chunk's timestamps by its position.
import { useEffect, useRef, useState } from "react";
import { T } from "./theme";
import { qbAuthFetch } from "./net";
import { useOutlookMail } from "./outlook/useOutlookMail";
import { walkPdfFile, snippetLabel } from "./walkPdf";

const fmtT = (t) => `${Math.floor(t / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, "0")}`;

// AudioBuffer channel → 16-bit PCM WAV bytes.
function wavBytes(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); ws(8, "WAVE");
  ws(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ws(36, "data"); v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}
function toB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Decode any video/audio file's soundtrack → 16 kHz mono Float32Array.
async function extractAudioFast(file) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const raw = await file.arrayBuffer();
  const ac = new AC();
  let decoded;
  try { decoded = await ac.decodeAudioData(raw.slice(0)); }
  finally { try { ac.close(); } catch { /* ignore */ } }
  const rate = 16000;
  const len = Math.ceil(decoded.duration * rate);
  const oc = new OfflineAudioContext(1, len, rate);
  const src = oc.createBufferSource();
  src.buffer = decoded;
  src.connect(oc.destination);
  src.start();
  const rendered = await oc.startRendering();
  return { samples: rendered.getChannelData(0), rate, duration: decoded.duration, scale: 1 };
}

// Backup reader for videos the Web Audio decoder rejects ("Decoding failed" —
// e.g. iPhone camera-roll clips with Spatial Audio, whose APAC track only the
// <video> element can play): play the file through a hidden video routed into
// an audio graph and capture the soundtrack as it plays, pitch-preserved at
// 1.5× so the wait is shorter. Timestamps come back in captured time, so we
// return the measured scale (video time ÷ captured time) for the caller to
// map them onto the real video.
const RT_SPEED = 1.5;
async function extractAudioRealtime(file, onMsg, playGate) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url; video.playsInline = true; video.preload = "auto"; video.crossOrigin = "anonymous";
  video.style.cssText = "position:fixed;left:-9999px;width:2px;height:2px;opacity:0.01;pointer-events:none";
  document.body.appendChild(video);
  const undo = [];
  try {
    await new Promise((res, rej) => {
      video.onloadedmetadata = res;
      video.onerror = () => rej(new Error("This video can't be played in the browser — export/share it as a standard MP4 and try again."));
      const to = setTimeout(() => rej(new Error("The video took too long to open.")), 20000);
      undo.push(() => clearTimeout(to));
    });
    const duration = video.duration || 0;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    undo.push(() => { try { ac.close(); } catch { /* ignore */ } });
    const src = ac.createMediaElementSource(video); // reroutes sound into the graph — speakers stay silent
    const proc = ac.createScriptProcessor(4096, 1, 1);
    const mute = ac.createGain(); mute.gain.value = 0;
    const chunks = [];
    proc.onaudioprocess = (e) => { chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
    src.connect(proc); proc.connect(mute); mute.connect(ac.destination);
    try { video.preservesPitch = true; } catch { /* ignore */ }
    try { video.webkitPreservesPitch = true; } catch { /* ignore */ }
    try { video.playbackRate = RT_SPEED; } catch { /* ignore */ }
    await playGate(video, ac);
    const say = () => onMsg && onMsg(`Reading the video's audio (fast-forward)… ${fmtT(video.currentTime)} of ${fmtT(duration)} — keep this screen open`);
    say();
    await new Promise((res, rej) => {
      video.onended = res;
      video.onerror = () => rej(new Error("Playback failed partway through reading the video."));
      video.ontimeupdate = say;
      let last = -1, still = 0;
      const iv = setInterval(() => {
        if (video.ended) return;
        if (video.currentTime === last) { if (++still >= 8) rej(new Error("The video stalled while its audio was being read — try again with the screen kept on.")); }
        else { still = 0; last = video.currentTime; }
      }, 2500);
      undo.push(() => clearInterval(iv));
    });
    proc.onaudioprocess = null;
    const total = chunks.reduce((n, c) => n + c.length, 0);
    if (!total) throw new Error("No audio could be read from this video.");
    const sr = ac.sampleRate;
    const all = new Float32Array(total);
    let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    const rate = 16000;
    const outLen = Math.floor(total * rate / sr);
    const samples = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const p = i * sr / rate, i0 = Math.floor(p), f = p - i0;
      samples[i] = all[i0] + ((all[i0 + 1] - all[i0]) || 0) * f;
    }
    let scale = duration / (total / sr);
    if (!isFinite(scale) || scale <= 0.5 || scale > 4) scale = RT_SPEED;
    return { samples, rate, duration, scale };
  } finally {
    undo.forEach((f) => { try { f(); } catch { /* ignore */ } });
    try { video.pause(); } catch { /* ignore */ }
    video.remove();
    URL.revokeObjectURL(url);
  }
}

async function extractAudio(file, onMsg, playGate) {
  try { return await extractAudioFast(file); }
  catch {
    onMsg && onMsg("This video needs the backup audio reader — opening it…");
    return await extractAudioRealtime(file, onMsg, playGate);
  }
}

// Grab a JPEG frame from the video at t seconds (hidden element, seek + draw).
// iOS won't paint a video into a canvas until a frame is actually PRESENTED —
// a bare seek often draws blank. So we wait for requestVideoFrameCallback
// after the seek, and if the drawing still comes out uniform (all one color),
// give the decoder a beat and draw once more.
function grabFrame(video, t) {
  const draw = () => {
    const w = 480, h = Math.round((video.videoHeight / video.videoWidth) * 480) || 320;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.drawImage(video, 0, 0, w, h);
    let uniform = true;
    try {
      const px = ctx.getImageData(0, 0, w, h).data;
      const r = px[0], g = px[1], b = px[2];
      for (const i of [1, w - 2, (h - 2) * w, (h - 2) * w + w - 2, ((h >> 1) * w) + (w >> 1)]) {
        const o = i * 4;
        if (Math.abs(px[o] - r) > 6 || Math.abs(px[o + 1] - g) > 6 || Math.abs(px[o + 2] - b) > 6) { uniform = false; break; }
      }
    } catch { uniform = false; }
    return { data: c.toDataURL("image/jpeg", 0.72), uniform };
  };
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return; settled = true;
      try {
        const first = draw();
        if (!first.uniform) { resolve(first.data); return; }
        setTimeout(() => { try { resolve(draw().data); } catch { resolve(first.data); } }, 280);
      } catch { resolve(null); }
    };
    const to = setTimeout(finish, 5000); // grab whatever is painted rather than nothing
    const onSeek = () => {
      video.removeEventListener("seeked", onSeek);
      clearTimeout(to);
      if (video.requestVideoFrameCallback) { video.requestVideoFrameCallback(finish); setTimeout(finish, 1500); }
      else requestAnimationFrame(() => requestAnimationFrame(finish));
    };
    video.addEventListener("seeked", onSeek);
    try { video.currentTime = Math.max(0.1, t); } catch { clearTimeout(to); finish(); }
  });
}

// ---- Background jobs: transcription runs at module level, OUTSIDE the popup,
// so closing it (or moving to another page) doesn't stop the work — it just
// keeps going and the Tasks-tab button shows "Transcribing…" until it's done.
// One job per property; extra clips append to the same punch list.
const wkJobs = {};
const wkSubs = new Set();
const wkEmit = () => wkSubs.forEach((f) => { try { f(); } catch { /* ignore */ } });
const wkGet = (pid) => wkJobs[pid] || null;
const wkSet = (pid, patch) => { wkJobs[pid] = { ...(wkJobs[pid] || { items: [], clips: 0, status: "idle", msg: "", err: "", tap: null }), ...patch }; wkEmit(); };
export const clearWalkJob = (pid) => { delete wkJobs[pid]; wkEmit(); };
export function useWalkJob(propertyId) {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); wkSubs.add(f); return () => { wkSubs.delete(f); }; }, []);
  return wkGet(propertyId);
}

async function processClip(property, file, label) {
  const pid = property.id;
  const say = (m) => wkSet(pid, { msg: label + m });
  // iOS quirk: without a fresh user gesture, ac.resume() and video.play() can
  // hang PENDING forever instead of rejecting — so never await them bare.
  // Try to start; unless both the context and playback are confirmed running
  // within 3s, ask for one tap (which restarts from 0:00 so no audio is lost).
  // The tap handler calls play()/resume() synchronously inside the click.
  const playGate = (video, ac) => new Promise((res, rej) => {
    let settled = false;
    const ok = () => { if (!settled) { settled = true; res(); } };
    const needTap = () => {
      if (settled) return;
      try { video.pause(); } catch { /* ignore */ }
      wkSet(pid, {
        msg: "Your phone needs one tap to open the video — hit the button below.",
        tap: () => {
          wkSet(pid, { tap: null });
          try { video.currentTime = 0; } catch { /* ignore */ }
          const p = video.play();
          try { ac.resume(); } catch { /* ignore */ }
          Promise.resolve(p).then(ok, rej);
        },
      });
    };
    try { ac.resume().catch(() => { /* ignore */ }); } catch { /* ignore */ }
    Promise.resolve(video.play()).then(() => { if (ac.state === "running") ok(); }).catch(() => { /* tap will handle it */ });
    const t0 = setTimeout(needTap, 3000);
    const iv = setInterval(() => {
      if (settled) { clearTimeout(t0); clearInterval(iv); return; }
      if (ac.state === "running" && !video.paused && video.currentTime > 0) { clearTimeout(t0); clearInterval(iv); ok(); }
    }, 300);
  });
  const url = URL.createObjectURL(file);
  try {
    say("Reading the video's audio…");
    const { samples, rate, duration, scale = 1 } = await extractAudio(file, say, playGate);
    wkSet(pid, { tap: null });
    const CHUNK = 150 * rate; // 2.5-minute pieces stay well inside the upload limit
    const span = 150 * scale; // real video seconds each chunk covers
    const segments = [];
    for (let off = 0; off < samples.length; off += CHUNK) {
      const part = samples.subarray(off, Math.min(off + CHUNK, samples.length));
      const t0 = (off / rate) * scale;
      say(duration > span + 5 ? `Transcribing ${fmtT(t0)}–${fmtT(Math.min(duration, t0 + span))} of ${fmtT(duration)}…` : "Transcribing your narration…");
      const b64 = toB64(wavBytes(part, rate));
      const d = await qbAuthFetch("/api/ai/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audio: b64, timestamps: 1 }) });
      (d.segments || []).forEach((sg) => segments.push({ start: (Number(sg.start) || 0) * scale + t0, end: (Number(sg.end) || 0) * scale + t0, text: sg.text }));
    }
    if (!segments.length) throw new Error("No speech was found in this video — was the narration audible?");
    say("Building your punch list…");
    const out = await qbAuthFetch("/api/ai/walkthrough", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ segments, address: property.address || "" }) });
    const clipNo = (wkGet(pid)?.clips || 0) + 1;
    const list = (out.items || []).map((it, i) => ({ ...it, id: Date.now() + i, image: null, clip: clipNo }));
    if (!list.length) throw new Error("The AI couldn't find any work items in the narration.");
    // Frame grabs — one hidden video element, sequential seeks. The element
    // must be in the DOM and have PLAYED (muted — no gesture needed) before
    // iOS will paint it into a canvas; a never-played video draws blank.
    say(`Grabbing ${list.length} photo${list.length !== 1 ? "s" : ""} from the video…`);
    const vid = document.createElement("video");
    vid.src = url; vid.muted = true; vid.playsInline = true; vid.preload = "auto";
    vid.style.cssText = "position:fixed;left:-9999px;width:2px;height:2px;opacity:0.01;pointer-events:none";
    document.body.appendChild(vid);
    try {
      await new Promise((r) => { vid.onloadeddata = r; vid.onerror = r; setTimeout(r, 6000); });
      try { await vid.play(); await new Promise((r) => setTimeout(r, 200)); vid.pause(); } catch { /* ignore */ }
      for (const it of list) it.image = await grabFrame(vid, (Number(it.start) || 0) + 0.3);
    } finally { vid.remove(); }
    wkSet(pid, { items: [...(wkGet(pid)?.items || []), ...list], clips: clipNo });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Kick off one or more videos for a property. Runs to completion whether or
// not the popup stays open; items append across clips.
export async function startWalkClips(property, files) {
  const pid = property.id;
  const fl = Array.from(files || []).filter(Boolean);
  if (!fl.length || wkGet(pid)?.status === "proc") return;
  wkSet(pid, { status: "proc", err: "", tap: null });
  let lock = null;
  try { lock = await navigator.wakeLock?.request?.("screen"); } catch { /* ignore */ }
  try {
    for (let i = 0; i < fl.length; i++) {
      await processClip(property, fl[i], fl.length > 1 ? `Video ${i + 1} of ${fl.length}: ` : "");
    }
    wkSet(pid, { status: "ready", msg: "", tap: null });
  } catch (e) {
    const has = (wkGet(pid)?.items || []).length;
    wkSet(pid, { status: has ? "ready" : "idle", err: e.message || "Couldn't process this video.", msg: "", tap: null });
  } finally {
    try { lock && lock.release(); } catch { /* ignore */ }
  }
}

export function WalkthroughModal({ property, onUpdate, onClose }) {
  const mail = useOutlookMail();
  const job = useWalkJob(property.id);
  const items = job?.items || [];
  const [step, setStep] = useState("idle"); // idle | rec — processing/review states live in the job store
  const [adding, setAdding] = useState(false); // items exist but the user wants to add another video
  const [err, setErr] = useState("");
  const [recSec, setRecSec] = useState(0);
  const [contractor, setContractor] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [flash, setFlash] = useState("");
  const [busy, setBusy] = useState("");
  const liveRef = useRef(null);
  const mrRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);

  useEffect(() => () => {
    clearInterval(timerRef.current);
    try { streamRef.current && streamRef.current.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
  }, []);
  useEffect(() => { if (step === "rec" && liveRef.current && streamRef.current) { liveRef.current.srcObject = streamRef.current; liveRef.current.play().catch(() => {}); } }, [step]);

  const view = step === "rec" ? "rec" : job?.status === "proc" ? "proc" : items.length && !adding ? "review" : "start";
  const showErr = err || job?.err || "";

  const startRec = async () => {
    setErr("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: true });
      streamRef.current = stream;
      const mime = ["video/mp4", "video/webm;codecs=vp8,opus", "video/webm"].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
      const mr = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 2000000, audioBitsPerSecond: 64000 });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        try { stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
        clearInterval(timerRef.current);
        const type = mime || "video/webm";
        const blob = new Blob(chunksRef.current, { type });
        setStep("idle"); setAdding(false);
        startWalkClips(property, [new File([blob], `walkthrough.${type.includes("mp4") ? "mp4" : "webm"}`, { type })]);
      };
      mrRef.current = mr;
      mr.start(1000);
      setRecSec(0);
      timerRef.current = setInterval(() => setRecSec((s) => s + 1), 1000);
      setStep("rec");
    } catch (e) {
      setErr("Camera/microphone permission is needed to record — or upload a video instead. (" + (e.message || e.name) + ")");
    }
  };
  const stopRec = () => { try { mrRef.current && mrRef.current.state !== "inactive" && mrRef.current.stop(); } catch { /* ignore */ } };

  const up = (id, k, v) => wkSet(property.id, { items: items.map((it) => (it.id === id ? { ...it, [k]: v } : it)) });
  const del = (id) => wkSet(property.id, { items: items.filter((it) => it.id !== id) });
  const addBlank = () => wkSet(property.id, { items: [...items, { id: Date.now(), title: "", detail: "", room: "General", quote: "", start: 0, end: 0, image: null, clip: job?.clips || 1 }] });

  const makeTasks = () => {
    const good = items.filter((it) => it.title.trim());
    if (!good.length) return;
    const at = Date.now();
    onUpdate(property.id, "tasks", [
      ...(property.tasks || []),
      ...good.map((it, i) => ({ id: at + i, text: `${it.room && it.room !== "General" ? it.room + ": " : ""}${it.title}`, cat: "Walkthrough", status: "Not Started", assignee: "" })),
    ]);
    setFlash(`✓ ${good.length} task${good.length !== 1 ? "s" : ""} added to ${property.address}`);
    setTimeout(() => setFlash(""), 2500);
  };

  const buildPdf = async () => {
    const good = items.filter((it) => it.title.trim());
    return walkPdfFile({
      address: property.address || "",
      cityLine: `${property.city || ""}${property.city && property.state ? ", " : ""}${property.state || ""}${property.zip ? " " + property.zip : ""}`,
      dateLabel: new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
      contractor: contractor.trim(),
      items: good,
    });
  };
  const downloadPdf = async () => {
    setBusy("pdf"); setErr("");
    try {
      const file = await buildPdf();
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: file.name }).catch(() => {}); }
      else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(file); a.download = file.name;
        document.body.appendChild(a); a.click(); a.remove();
      }
    } catch (e) { setErr(e.message || "Couldn't build the PDF."); }
    setBusy("");
  };
  const emailPdf = async () => {
    if (!emailTo.trim()) { setErr("Enter the contractor's email first."); return; }
    setBusy("email"); setErr("");
    try {
      const file = await buildPdf();
      const html = `<div>Hi,<br><br>Please see the attached punch list for ${property.address || "the property"} — ${items.filter((i) => i.title.trim()).length} items from today's walkthrough.<br><br>Thanks,<br>Goldstone Properties</div>`;
      await mail.sendNew({ to: emailTo.trim(), subject: `${property.address || ""} Punch List`.trim(), html, files: [file] });
      setFlash("✓ Emailed " + emailTo.trim());
      setTimeout(() => setFlash(""), 2500);
    } catch (e) { setErr(e.message || "Couldn't send the email."); }
    setBusy("");
  };

  const rooms = [];
  items.forEach((it) => { const r = it.room || "General"; if (!rooms.includes(r)) rooms.push(r); });
  const multiClip = items.some((i) => (i.clip || 1) > 1);
  const btn = (bg, fg) => ({ padding: "12px", borderRadius: 12, border: "none", background: bg, color: fg, fontWeight: 700, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit" });

  return (
    <div onClick={view === "rec" ? undefined : onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 460, display: "flex", alignItems: "center", justifyContent: "center", padding: 10, backdropFilter: "blur(5px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.bg, borderRadius: 20, width: "min(560px,96vw)", maxHeight: "94vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: T.shadowMd }}>
        <div style={{ padding: "16px 18px 12px", background: T.card, borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: T.text }}>🎥 Walkthrough — {property.address}</div>
            <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 2 }}>
              {view === "review" ? `${items.length} item${items.length !== 1 ? "s" : ""}${(job?.clips || 1) > 1 ? ` from ${job.clips} videos` : ""} — tap any text to edit, × to drop` : "Walk and talk — the AI writes the punch list."}
            </div>
          </div>
          {view !== "rec" && <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: T.textTert, cursor: "pointer", lineHeight: 1 }}>×</button>}
        </div>

        {showErr && <div style={{ margin: "10px 14px 0", padding: "9px 12px", background: "#FFF0EF", border: `1px solid ${T.red}`, borderRadius: 10, color: T.red, fontSize: 12.5 }}>{showErr}</div>}
        {flash && <div style={{ margin: "10px 14px 0", padding: "9px 12px", background: "#EAF7EE", border: "1px solid #BFE8CD", borderRadius: 10, color: "#15803D", fontSize: 12.5, fontWeight: 600 }}>{flash}</div>}

        {view === "start" && (
          <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
            {items.length > 0 && (
              <button onClick={() => setAdding(false)} style={{ background: "none", border: "none", color: T.blue, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", textAlign: "left", padding: 0 }}>
                ← Back to your {items.length} item{items.length !== 1 ? "s" : ""}
              </button>
            )}
            <button onClick={startRec} style={{ ...btn(T.gold, "#fff"), padding: 16, fontSize: 15, boxShadow: `0 2px 10px ${T.gold}55` }}>🎥 Record a walkthrough now</button>
            <label style={{ ...btn(T.card, T.text), padding: 16, fontSize: 15, textAlign: "center", border: `1px solid ${T.border}` }}>
              📁 Upload videos (camera roll / sent to you)
              <input type="file" accept="video/*,audio/*" multiple style={{ display: "none" }} onChange={(e) => { const fl = Array.from(e.target.files || []); if (fl.length) { setErr(""); setAdding(false); startWalkClips(property, fl); } e.target.value = ""; }} />
            </label>
            <div style={{ fontSize: 11.5, color: T.textSub, lineHeight: 1.55, padding: "2px 4px" }}>
              Talk naturally as you walk — "master bath, regrout the tub… replace this outlet cover". Long videos are fine (5–10 minutes).
              Pick several videos at once (exterior, interior…) — they all land on one punch list. Each item gets the video frame from the
              moment you said it, plus the exact snippet time for the contractor.
            </div>
          </div>
        )}

        {step === "rec" && (
          <div style={{ background: "#000", position: "relative" }}>
            <video ref={liveRef} muted playsInline style={{ width: "100%", maxHeight: "62vh", display: "block", objectFit: "cover" }} />
            <div style={{ position: "absolute", top: 10, left: 0, right: 0, display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}>
              <span style={{ width: 9, height: 9, borderRadius: 5, background: "#FF3B30", boxShadow: "0 0 8px #FF3B30" }} />
              <span style={{ color: "#fff", fontWeight: 800, fontSize: 14 }}>REC {fmtT(recSec)}</span>
            </div>
            <div style={{ padding: "14px 16px 18px", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
              <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 11.5, textAlign: "center", lineHeight: 1.5 }}>Point at the problem and say what needs doing. Stop when you're finished — the list builds itself.</div>
              <button onClick={stopRec} style={{ width: 64, height: 64, borderRadius: 34, border: "4px solid #fff", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ width: 26, height: 26, borderRadius: 6, background: "#FF3B30" }} />
              </button>
            </div>
          </div>
        )}

        {view === "proc" && (
          <div style={{ padding: "38px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 34, marginBottom: 12 }}>🎞️</div>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: T.text }}>{job?.msg || "Working…"}</div>
            {job?.tap ? (
              <button onClick={job.tap} style={{ marginTop: 16, padding: "13px 26px", borderRadius: 14, border: "none", background: T.gold, color: "#fff", fontSize: 15, fontWeight: 750, fontFamily: "inherit", cursor: "pointer" }}>▶ Tap to continue</button>
            ) : (
              <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 10, lineHeight: 1.6, maxWidth: 380, marginLeft: "auto", marginRight: "auto" }}>
                You can close this and keep using the app — the work continues, and the 🎥 button on the Tasks tab shows "Transcribing…" until it's done.
                If the phone locks or you leave the app it pauses, then picks back up when you return.
              </div>
            )}
          </div>
        )}

        {view === "review" && (
          <>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {rooms.map((room) => (
                <div key={room}>
                  <div style={{ padding: "8px 14px 4px", fontSize: 10, fontWeight: 800, color: T.textTert, letterSpacing: "0.05em", background: T.bg }}>{room.toUpperCase()} · {items.filter((i) => (i.room || "General") === room).length}</div>
                  {items.filter((i) => (i.room || "General") === room).map((it) => (
                    <div key={it.id} style={{ display: "flex", gap: 10, padding: "10px 12px", background: T.card, borderBottom: `1px solid ${T.border}`, alignItems: "center" }}>
                      {it.image
                        ? <img src={it.image} alt="" style={{ width: 82, height: 58, objectFit: "cover", borderRadius: 9, flexShrink: 0 }} />
                        : <div style={{ width: 82, height: 58, borderRadius: 9, background: T.bg, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📷</div>}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <input value={it.title} onChange={(e) => up(it.id, "title", e.target.value)} placeholder="What needs doing…" style={{ width: "100%", border: "none", background: "transparent", fontSize: 13, fontWeight: 650, color: T.text, outline: "none", fontFamily: "inherit", padding: 0 }} />
                        <input value={it.detail} onChange={(e) => up(it.id, "detail", e.target.value)} placeholder="Detail for the contractor…" style={{ width: "100%", border: "none", background: "transparent", fontSize: 11, color: T.textSub, outline: "none", fontFamily: "inherit", padding: "2px 0 0" }} />
                        <div style={{ fontSize: 10, color: T.textTert, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{snippetLabel(it, multiClip)}{it.quote ? ` · "${it.quote}"` : ""}</div>
                      </div>
                      <button onClick={() => del(it.id)} style={{ background: "none", border: "none", color: T.red, fontSize: 17, cursor: "pointer", width: 26, flexShrink: 0 }}>×</button>
                    </div>
                  ))}
                </div>
              ))}
              <button onClick={addBlank} style={{ display: "block", width: "100%", minHeight: 44, background: "transparent", border: "none", color: T.blue, cursor: "pointer", fontSize: 13, fontFamily: "inherit", fontWeight: 600 }}>+ Add item</button>
            </div>
            <div style={{ background: T.card, borderTop: `1px solid ${T.border}`, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { setErr(""); setAdding(true); }} style={{ ...btn(T.bg, T.text), flex: 1, border: `1px solid ${T.border}`, padding: "9px 12px", fontSize: 12.5 }}>➕ Add another video</button>
                <button onClick={() => { if (window.confirm("Throw away this punch list and start fresh?")) { setAdding(false); clearWalkJob(property.id); } }} title="Start over" style={{ ...btn(T.bg, T.red), border: `1px solid ${T.border}`, padding: "9px 14px", fontSize: 12.5 }}>🗑</button>
              </div>
              <input value={contractor} onChange={(e) => setContractor(e.target.value)} placeholder='PDF "Prepared for" — contractor name (optional)' style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${T.border}`, background: T.bg, fontSize: 12.5, outline: "none", fontFamily: "inherit" }} />
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={makeTasks} style={{ ...btn(T.bg, T.text), flex: 1, border: `1px solid ${T.border}` }}>→ Add as tasks</button>
                <button onClick={downloadPdf} disabled={busy === "pdf"} style={{ ...btn(T.gold, "#fff"), flex: 1.4, boxShadow: `0 2px 10px ${T.gold}55` }}>{busy === "pdf" ? "Building…" : "📄 Punch-list PDF"}</button>
              </div>
              {mail.signedIn && (
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="Contractor's email…" style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: `1px solid ${T.border}`, background: T.bg, fontSize: 12.5, outline: "none", fontFamily: "inherit" }} />
                  <button onClick={emailPdf} disabled={busy === "email"} style={btn("#3B6EA5", "#fff")}>{busy === "email" ? "Sending…" : "📧 Email PDF"}</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
