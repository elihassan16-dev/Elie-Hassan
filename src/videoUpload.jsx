// Background video uploads for chat — shared by the team app, the admin job
// popup, and the contractor portal. Picking a video stages it INSTANTLY and the
// message can be sent right away with a placeholder attachment
// {kind:"video", pending:true, uploadId}; the file streams up to Cloudflare in
// the background and the saved message is patched with the real attachment when
// it lands. The sender sees a live progress bubble; everyone else sees
// "video on its way" until the patch syncs over.
//
// iPhones suspend a web app's work seconds after it's backgrounded and reload
// it freely — so the pending file also lives in IndexedDB on the sender's
// device. Reopening the app resumes any unfinished upload; after too many
// tries (or 24h) the message is patched to a clear "didn't upload" instead of
// saying "on its way" forever. Coming back to the foreground also restarts an
// upload that stalled while the phone was asleep.
//
// Since 10/16/26 (Elie — "pictures and videos are very hard to upload,
// especially if he leaves the app") EVERY attachment goes this way, not just
// videos: photos, photo grids, voice notes and files are sent instantly as a
// placeholder ({kind, pending, uploadId, w/h, dur, wave}), go up in the
// background, retry by themselves, and resume after the app was closed. Videos
// also resume mid-file (tus session kept on the device) instead of restarting.
import { useEffect, useState } from "react";
import { uploadStreamVideo, uploadAttachment, waitStreamReady, streamDims, imageDims, attachmentKind } from "./net";
import { supabase } from "./supabaseClient";
import { T } from "./theme";

const uploads = {}; // uploadId -> {pct, status, att, error, placeholder, file, folder, ctrMsgId, listeners, attempt, lastProgressAt}

// ── On-device persistence (IndexedDB) ─────────────────────────────────────────
// Best-effort everywhere: private mode / storage pressure just means no resume.
const idbOpen = () => new Promise((res, rej) => {
  if (typeof indexedDB === "undefined") { rej(new Error("no idb")); return; }
  const r = indexedDB.open("gp-video-uploads", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("pending", { keyPath: "uploadId" });
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function idbWrite(fn) {
  try {
    const db = await idbOpen();
    await new Promise((res, rej) => { const tx = db.transaction("pending", "readwrite"); fn(tx.objectStore("pending")); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    db.close();
  } catch { /* persistence is best-effort */ }
}
const idbPut = (entry) => idbWrite((st) => st.put(entry));
const idbDel = (uploadId) => idbWrite((st) => st.delete(uploadId));
async function idbAll() {
  try {
    const db = await idbOpen();
    const rows = await new Promise((res, rej) => { const q = db.transaction("pending").objectStore("pending").getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); });
    db.close();
    return rows;
  } catch { return []; }
}
async function idbMerge(uploadId, patch) {
  try {
    const db = await idbOpen();
    await new Promise((res, rej) => {
      const tx = db.transaction("pending", "readwrite"), st = tx.objectStore("pending");
      const q = st.get(uploadId);
      q.onsuccess = () => { if (q.result) st.put({ ...q.result, ...patch }); };
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch { /* best-effort */ }
}

// Warn before closing the tab while an upload is still running (desktop browsers;
// iOS home-screen apps don't show this — IndexedDB resume covers them instead).
let unloadArmed = false;
const onUnload = (e) => { e.preventDefault(); e.returnValue = "A video is still uploading — leaving now pauses it until you reopen the app."; };
const syncUnloadGuard = () => {
  const active = Object.values(uploads).some((u) => u.status === "uploading");
  if (active && !unloadArmed) { window.addEventListener("beforeunload", onUnload); unloadArmed = true; }
  if (!active && unloadArmed) { window.removeEventListener("beforeunload", onUnload); unloadArmed = false; }
};

// The always-mounted app shell registers this to patch placeholder attachments
// wherever internal messages live (properties, tasks, office chat).
let internalPatcher = null;
export const setVideoPatcher = (fn) => { internalPatcher = fn; };

const finalAtt = (u) => (u.status === "done" ? u.att : { ...u.placeholder, pending: false, failed: true, error: u.error || "Upload failed" });
const ping = (u) => u.listeners.forEach((fn) => { try { fn(u); } catch { /* listener gone */ } });

// Patch a saved contractor_messages row in place (works from the portal and the
// admin side; RLS already lets each sender update their own thread's rows). The
// realtime subscription every client holds re-renders the bubble automatically.
async function patchCtrRow(msgId, uploadId, att) {
  try {
    const { data } = await supabase.from("contractor_messages").select("id,data,org_id").eq("id", String(msgId)).single();
    const msg = data && data.data;
    if (!msg || !msg.attachment || msg.attachment.uploadId !== uploadId || !(msg.attachment.pending || msg.attachment.failed)) return;
    await supabase.from("contractor_messages").upsert(
      { id: String(msgId), org_id: data.org_id, data: { ...msg, attachment: att }, updated_at: new Date().toISOString() },
      { onConflict: "id" }
    );
  } catch { /* best-effort — the bubble shows the stale state and the sender can resend */ }
}

// "Tell me when it's watchable" — notify() hangs the ready-to-watch banner on
// this. Fires once, only for a successful upload; a failed one stays quiet
// (the bubble already says so). In-memory only: an upload resumed after a
// reload finishes silently.
const readyFns = {};
export function onVideoReady(uploadId, fn) {
  const u = uploads[uploadId];
  if (u && u.status === "done") { try { fn(); } catch { /* listener */ } return; }
  if (u && u.status === "failed") return;
  (readyFns[uploadId] = readyFns[uploadId] || []).push(fn);
}

function settle(uploadId) {
  const u = uploads[uploadId];
  const att = finalAtt(u);
  ping(u);
  if (u.status === "done") (readyFns[uploadId] || []).forEach((fn) => { try { fn(); } catch { /* listener */ } });
  delete readyFns[uploadId];
  // Patch the message now and again over the next minutes: right after a reload
  // the resumed upload can finish BEFORE the app's data loads, so an immediate
  // scan finds nothing. Re-applying is safe — only still-pending placeholders
  // ever get touched.
  const applyPatches = () => {
    if (internalPatcher) { try { internalPatcher(uploadId, att); } catch { /* best-effort */ } }
    if (u.ctrMsgId) patchCtrRow(u.ctrMsgId, uploadId, att);
  };
  applyPatches();
  [5000, 20000, 60000, 180000].forEach((ms) => setTimeout(applyPatches, ms));
  idbDel(uploadId);
  syncUnloadGuard();
}

// One upload attempt. `attempt` tokens make restarts safe: a superseded attempt
// (e.g. one that hung while the phone slept) can't settle over the live one.
function runUpload(uploadId) {
  const u = uploads[uploadId];
  if (u.files) { runMediaUpload(uploadId); return; }
  const token = ++u.attempt;
  u.status = "uploading"; u.stage = u.upFile ? "upload" : "compress"; u.lastProgressAt = Date.now();
  syncUnloadGuard();
  (async () => {
    try {
      // WhatsApp-style shrink before the bytes go up (hardware encoder; ~10x
      // smaller). Returns null whenever it can't/shouldn't — original uploads.
      if (!u.upFile) {
        u.stage = "compress"; u.pct = 0; ping(u);
        try {
          const { compressVideo } = await import("./videoCompress");
          const small = await compressVideo(u.file, (p) => { if (u.attempt !== token) return; u.pct = p; u.lastProgressAt = Date.now(); ping(u); });
          if (u.attempt !== token) return;
          u.upFile = small || u.file;
          // Keep the shrunk copy on the device — a resume skips re-compressing.
          if (small) idbMerge(uploadId, { upFile: small });
        } catch { u.upFile = u.file; }
      }
      u.stage = "upload"; u.pct = 0; u.lastProgressAt = Date.now(); ping(u);
      let att;
      try {
        att = await uploadStreamVideo(u.upFile, (p) => { if (u.attempt !== token) return; u.pct = p; u.lastProgressAt = Date.now(); ping(u); }, {
          resume: u.tus || null,
          onSession: (sess) => { u.tus = sess; idbMerge(uploadId, { tus: sess }); },
        });
      }
      catch (ex) {
        // Stream hiccup → small clips still fit the plain-storage path.
        if (u.upFile.size <= 50 * 1024 * 1024) att = await uploadAttachment(u.upFile, u.folder);
        else throw ex;
      }
      if (u.attempt !== token) return;
      // Hold the "on its way" bubble until Cloudflare has finished transcoding —
      // swapping in the player early shows an error screen to whoever taps it.
      if (att && att.stream && att.uid) {
        u.stage = "process"; u.lastProgressAt = Date.now(); ping(u);
        const readiness = await waitStreamReady(att.uid);
        if (u.attempt !== token) return;
        if (readiness === "error") throw new Error("Cloudflare couldn't process that video — try sending it again.");
        const d = await streamDims(att.uid);
        if (d) { if (d.w && d.h) { att.w = d.w; att.h = d.h; } if (d.dur) att.dur = Math.round(d.dur); if (d.thumbnail) att.thumbnail = d.thumbnail; }
      }
      u.att = att; u.status = "done";
    } catch (ex) {
      if (u.attempt !== token) return;
      u.status = "failed"; u.error = ex.message || "Upload failed";
    }
    settle(uploadId);
  })();
}

// Photos / voice notes / files. Each file goes up on its own (a grid of 10
// photos survives one bad connection), with automatic retries before giving up.
function runMediaUpload(uploadId) {
  const u = uploads[uploadId];
  const token = ++u.attempt;
  u.status = "uploading"; u.stage = "upload"; u.lastProgressAt = Date.now();
  u.done = u.done || [];
  syncUnloadGuard();
  (async () => {
    try {
      const n = u.files.length;
      for (let i = 0; i < n; i++) {
        if (u.done[i]) continue;
        let up = null, lastErr = null;
        for (let tryN = 0; tryN < 3 && !up; tryN++) {
          try { up = await uploadAttachment(u.files[i], u.folder); }
          catch (ex) { lastErr = ex; await new Promise((r) => setTimeout(r, 1500 * (tryN + 1))); }
          if (u.attempt !== token) return;
        }
        if (!up) throw lastErr || new Error("Upload failed");
        u.done[i] = up;
        idbMerge(uploadId, { done: u.done });
        u.pct = Math.round(((i + 1) / n) * 100); u.lastProgressAt = Date.now(); ping(u);
      }
      const ph = u.placeholder;
      if (ph.kind === "images") {
        const items = u.done.map((d, i) => ({ ...d, kind: "image", ...((ph.items || [])[i] || {}), url: d.url, name: d.name, mime: d.mime }));
        u.att = { kind: "images", items, name: `${items.length} photos`, url: items[0].url };
      } else {
        const d = u.done[0];
        u.att = { ...d, ...(ph.w && ph.h && !d.w ? { w: ph.w, h: ph.h } : {}), ...(ph.dur ? { dur: ph.dur } : {}), ...(ph.wave ? { wave: ph.wave } : {}) };
      }
      u.status = "done";
    } catch (ex) {
      if (u.attempt !== token) return;
      u.status = "failed"; u.error = (ex && ex.message) || "Upload failed";
    }
    settle(uploadId);
  })();
}

// The sender's own copy of what's uploading — shown in the bubble right away
// (memory only; other people see "on its way" until the real file lands).
const previews = {};
export const localPreview = (uploadId, i = 0) => (previews[uploadId] || [])[i] || "";

// Stage photos (several → one grid message), a voice note or a file. Returns the
// placeholder attachment to send RIGHT AWAY. meta = {dur, wave} for voice notes.
export async function startMediaUpload(files, folder = "chat", meta = {}) {
  const list = (Array.isArray(files) ? files : [files]).filter(Boolean);
  if (!list.length) return null;
  if (list.length === 1 && (list[0].type || "").startsWith("video/")) return startVideoUpload(list[0], folder);
  const kinds = list.map((f) => attachmentKind(f.type || ""));
  const grid = list.length > 1;
  const uploadId = "mu-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const dims = await Promise.all(list.map((f, i) => (kinds[i] === "image" ? imageDims(f) : null)));
  try { previews[uploadId] = list.map((f, i) => (kinds[i] === "image" ? URL.createObjectURL(f) : "")); } catch { /* no preview */ }
  const placeholder = grid
    ? { kind: "images", pending: true, uploadId, name: `${list.length} photos`, items: list.map((f, i) => ({ name: f.name || `photo ${i + 1}`, ...(dims[i] || {}) })), startedAt: new Date().toISOString() }
    : { kind: kinds[0], pending: true, uploadId, name: list[0].name || kinds[0], mime: list[0].type || "", ...(dims[0] || {}), ...(meta.dur ? { dur: meta.dur } : {}), ...(meta.wave ? { wave: meta.wave } : {}), startedAt: new Date().toISOString() };
  uploads[uploadId] = { pct: 0, status: "uploading", att: null, error: "", placeholder, files: list, done: [], folder, ctrMsgId: null, listeners: new Set(), attempt: 0, lastProgressAt: Date.now() };
  idbPut({ uploadId, files: list, folder, placeholder, ctrMsgId: null, createdAt: Date.now(), attempts: 1 });
  runUpload(uploadId);
  return placeholder;
}

// "Try again" on a failed bubble (sender's device only).
export function retryUpload(uploadId) {
  const u = uploads[uploadId];
  if (!u || u.status !== "failed" || !(u.file || u.files)) return false;
  u.error = ""; u.pct = 0;
  idbPut({ uploadId, file: u.file || null, files: u.files || null, upFile: u.upFile || null, tus: u.tus || null, done: u.done || null, folder: u.folder, placeholder: u.placeholder, ctrMsgId: u.ctrMsgId, createdAt: Date.now(), attempts: 1 });
  runUpload(uploadId);
  ping(u);
  return true;
}

// Kick off the upload and return the placeholder attachment to send immediately.
export function startVideoUpload(file, folder = "chat") {
  const uploadId = "vu-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const placeholder = { kind: "video", stream: true, pending: true, uploadId, name: file.name || "video", mime: file.type || "video/mp4", startedAt: new Date().toISOString() };
  uploads[uploadId] = { pct: 0, status: "uploading", att: null, error: "", placeholder, file, folder, ctrMsgId: null, listeners: new Set(), attempt: 0, lastProgressAt: Date.now() };
  idbPut({ uploadId, file, folder, placeholder, ctrMsgId: null, createdAt: Date.now(), attempts: 1 });
  runUpload(uploadId);
  return placeholder;
}

export const videoUploadState = (uploadId) => uploads[uploadId] || null;

// If the upload already finished before the message was sent, swap the
// placeholder for the real attachment so no patch is ever needed.
export const resolveVideoAttachment = (att) => {
  if (!att || !att.uploadId || !att.pending) return att;
  const u = uploads[att.uploadId];
  if (!u || u.status === "uploading") return att;
  return finalAtt(u);
};

// A contractor_messages row was saved carrying this placeholder — remember it
// (in memory AND on disk, so a resumed upload after a reload still knows which
// row to patch) or patch immediately if the upload already settled.
export function bindCtrVideoMessage(uploadId, msgId) {
  const u = uploads[uploadId];
  if (!u) return;
  if (u.status === "uploading") { u.ctrMsgId = msgId; idbMerge(uploadId, { ctrMsgId: msgId }); }
  else patchCtrRow(msgId, uploadId, finalAtt(u));
}

// Called once the app is signed in (main shell + portal). Restarts uploads that
// died with the page; anything too old or too-many-times retried is patched to a
// clear failure so its message never says "on its way" forever.
let resumeRan = false;
export async function resumeVideoUploads() {
  if (resumeRan) return;
  resumeRan = true;
  const entries = await idbAll();
  for (const e of entries) {
    if (!e || !e.uploadId || uploads[e.uploadId]) continue;
    const dead = !(e.file || (e.files && e.files.length)) || (Date.now() - (e.createdAt || 0)) > 24 * 3600000 || (e.attempts || 0) >= 6;
    uploads[e.uploadId] = { pct: 0, status: "uploading", att: null, error: "", placeholder: e.placeholder || { kind: "video", pending: true, uploadId: e.uploadId }, file: e.file || null, files: e.files || null, done: e.done || [], upFile: e.upFile || null, tus: e.tus || null, folder: e.folder || "chat", ctrMsgId: e.ctrMsgId || null, listeners: new Set(), attempt: 0, lastProgressAt: Date.now() };
    if (e.files) { try { previews[e.uploadId] = e.files.map((f) => ((f.type || "").startsWith("image/") ? URL.createObjectURL(f) : "")); } catch { /* no preview */ } }
    if (dead) {
      const u = uploads[e.uploadId];
      u.status = "failed"; u.error = "The upload didn't finish";
      settle(e.uploadId);
      continue;
    }
    idbMerge(e.uploadId, { attempts: (e.attempts || 0) + 1 });
    runUpload(e.uploadId);
  }
}

// Coming back to the foreground: an upload that made no progress while the phone
// was asleep is hung — restart it (the attempt token retires the hung one).
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    Object.entries(uploads).forEach(([id, u]) => {
      // "process" = waiting on Cloudflare's transcode; its poll loop resumes on
      // its own after sleep — restarting would re-upload the whole file.
      if (u.status === "uploading" && u.stage !== "process" && (u.file || u.files) && Date.now() - (u.lastProgressAt || 0) > 90000) runUpload(id);
    });
  });
}

// Live state for a local upload (null when this device isn't doing the upload).
export function useVideoUpload(uploadId) {
  const [state, setState] = useState(() => { const u = uploadId && uploads[uploadId]; return u ? { pct: u.pct, status: u.status, stage: u.stage, att: u.att } : null; });
  useEffect(() => {
    const u = uploadId && uploads[uploadId];
    if (!u) { setState(null); return; }
    const fn = () => setState({ pct: u.pct, status: u.status, stage: u.stage, att: u.att });
    fn();
    u.listeners.add(fn);
    return () => u.listeners.delete(fn);
  }, [uploadId]);
  return state;
}

// Chat bubble for a video that hasn't finished uploading (or failed). Rendered
// by every attachment renderer before the normal kinds.
export function VideoUploadBubble({ att, mine }) {
  const live = useVideoUpload(att.uploadId);
  const fg = mine ? "#fff" : T.text, sub = mine ? "rgba(255,255,255,0.85)" : T.textSub;
  // No live upload on this device and it's been ages — call it dead on screen.
  // (If the sender's device eventually finishes it, the patch still wins.)
  const stale = att.pending && !live && att.startedAt && (Date.now() - new Date(att.startedAt).getTime()) > 45 * 60000;
  const failed = att.failed || (live && live.status === "failed") || stale;
  return (
    <div style={{ marginTop: 6, width: "min(240px,64vw)", padding: "10px 12px", borderRadius: 10, background: mine ? "rgba(255,255,255,0.15)" : T.bg, border: `1px solid ${mine ? "rgba(255,255,255,0.3)" : T.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18, flexShrink: 0 }}>{failed ? "⚠️" : "🎬"}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: failed ? (mine ? "#fff" : T.red) : fg }}>
            {failed ? "Video didn't upload" : live ? (live.stage === "compress" ? `Compressing video… ${live.pct || 0}%` : live.stage === "process" ? "Processing video…" : `Uploading video… ${live.pct || 0}%`) : "Video on its way…"}
          </div>
          <div style={{ fontSize: 10.5, color: sub, marginTop: 1 }}>
            {failed ? "Send it again when you have signal." : live ? (live.stage === "process" ? "Uploaded ✓ — it turns into the player by itself in a moment." : "Keep the app open until it finishes.") : "It appears here once the sender's upload finishes."}
          </div>
        </div>
      </div>
      {!failed && live && live.stage !== "process" && (
        <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: mine ? "rgba(255,255,255,0.25)" : T.border, overflow: "hidden" }}>
          <div style={{ width: `${live.pct || 0}%`, height: "100%", background: mine ? "#fff" : T.gold, transition: "width 0.3s" }} />
        </div>
      )}
    </div>
  );
}
