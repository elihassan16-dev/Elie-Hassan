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
import { useEffect, useState } from "react";
import { uploadStreamVideo, uploadAttachment } from "./net";
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
    if (!msg || !msg.attachment || msg.attachment.uploadId !== uploadId || !msg.attachment.pending) return;
    await supabase.from("contractor_messages").upsert(
      { id: String(msgId), org_id: data.org_id, data: { ...msg, attachment: att }, updated_at: new Date().toISOString() },
      { onConflict: "id" }
    );
  } catch { /* best-effort — the bubble shows the stale state and the sender can resend */ }
}

function settle(uploadId) {
  const u = uploads[uploadId];
  const att = finalAtt(u);
  ping(u);
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
        } catch { u.upFile = u.file; }
      }
      u.stage = "upload"; u.pct = 0; u.lastProgressAt = Date.now(); ping(u);
      let att;
      try { att = await uploadStreamVideo(u.upFile, (p) => { if (u.attempt !== token) return; u.pct = p; u.lastProgressAt = Date.now(); ping(u); }); }
      catch (ex) {
        // Stream hiccup → small clips still fit the plain-storage path.
        if (u.upFile.size <= 50 * 1024 * 1024) att = await uploadAttachment(u.upFile, u.folder);
        else throw ex;
      }
      if (u.attempt !== token) return;
      u.att = att; u.status = "done";
    } catch (ex) {
      if (u.attempt !== token) return;
      u.status = "failed"; u.error = ex.message || "Upload failed";
    }
    settle(uploadId);
  })();
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
    const dead = !e.file || (Date.now() - (e.createdAt || 0)) > 24 * 3600000 || (e.attempts || 0) >= 4;
    uploads[e.uploadId] = { pct: 0, status: "uploading", att: null, error: "", placeholder: e.placeholder || { kind: "video", pending: true, uploadId: e.uploadId }, file: e.file, folder: e.folder || "chat", ctrMsgId: e.ctrMsgId || null, listeners: new Set(), attempt: 0, lastProgressAt: Date.now() };
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
      if (u.status === "uploading" && u.file && Date.now() - (u.lastProgressAt || 0) > 90000) runUpload(id);
    });
  });
}

// Live state for a local upload (null when this device isn't doing the upload).
export function useVideoUpload(uploadId) {
  const [state, setState] = useState(() => { const u = uploadId && uploads[uploadId]; return u ? { pct: u.pct, status: u.status, stage: u.stage } : null; });
  useEffect(() => {
    const u = uploadId && uploads[uploadId];
    if (!u) { setState(null); return; }
    const fn = () => setState({ pct: u.pct, status: u.status, stage: u.stage });
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
            {failed ? "Video didn't upload" : live ? (live.stage === "compress" ? `Compressing video… ${live.pct || 0}%` : `Uploading video… ${live.pct || 0}%`) : "Video on its way…"}
          </div>
          <div style={{ fontSize: 10.5, color: sub, marginTop: 1 }}>
            {failed ? "Send it again when you have signal." : live ? "Keep the app open until it finishes." : "It appears here once the sender's upload finishes."}
          </div>
        </div>
      </div>
      {!failed && live && (
        <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: mine ? "rgba(255,255,255,0.25)" : T.border, overflow: "hidden" }}>
          <div style={{ width: `${live.pct || 0}%`, height: "100%", background: mine ? "#fff" : T.gold, transition: "width 0.3s" }} />
        </div>
      )}
    </div>
  );
}
