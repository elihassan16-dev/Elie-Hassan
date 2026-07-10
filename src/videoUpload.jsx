// Background video uploads for chat — shared by the team app, the admin job
// popup, and the contractor portal. Picking a video stages it INSTANTLY and the
// message can be sent right away with a placeholder attachment
// {kind:"video", pending:true, uploadId}; the file streams up to Cloudflare in
// the background and the saved message is patched with the real attachment when
// it lands. The sender sees a live progress bubble; everyone else sees
// "video on its way" until the patch syncs over.
import { useEffect, useState } from "react";
import { uploadStreamVideo, uploadAttachment } from "./net";
import { supabase } from "./supabaseClient";
import { T } from "./theme";

const uploads = {}; // uploadId -> {pct, status:"uploading"|"done"|"failed", att, error, placeholder, listeners, ctrBinds}

// Warn before closing the tab while an upload is still running (desktop browsers;
// iOS home-screen apps don't show this, so the chat bubble carries the state).
let unloadArmed = false;
const onUnload = (e) => { e.preventDefault(); e.returnValue = "A video is still uploading — leaving now cancels it."; };
const syncUnloadGuard = () => {
  const active = Object.values(uploads).some((u) => u.status === "uploading");
  if (active && !unloadArmed) { window.addEventListener("beforeunload", onUnload); unloadArmed = true; }
  if (!active && unloadArmed) { window.removeEventListener("beforeunload", onUnload); unloadArmed = false; }
};

// The always-mounted app shell registers this to patch placeholder attachments
// wherever internal messages live (properties, tasks, office chat).
let internalPatcher = null;
export const setVideoPatcher = (fn) => { internalPatcher = fn; };

const finalFailedAtt = (u) => ({ ...u.placeholder, pending: false, failed: true, error: u.error || "Upload failed" });
const finalAtt = (u) => (u.status === "done" ? u.att : finalFailedAtt(u));

function settle(uploadId) {
  const u = uploads[uploadId];
  const att = finalAtt(u);
  u.listeners.forEach((fn) => { try { fn(u); } catch { /* listener gone */ } });
  if (internalPatcher) { try { internalPatcher(uploadId, att); } catch { /* best-effort */ } }
  u.ctrBinds.splice(0).forEach((apply) => apply(att));
  syncUnloadGuard();
}

// Kick off the upload and return the placeholder attachment to send immediately.
export function startVideoUpload(file, folder = "chat") {
  const uploadId = "vu-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const placeholder = { kind: "video", stream: true, pending: true, uploadId, name: file.name || "video", mime: file.type || "video/mp4", startedAt: new Date().toISOString() };
  const u = uploads[uploadId] = { pct: 0, status: "uploading", att: null, error: "", placeholder, listeners: new Set(), ctrBinds: [] };
  syncUnloadGuard();
  (async () => {
    try {
      let att;
      try { att = await uploadStreamVideo(file, (p) => { u.pct = p; u.listeners.forEach((fn) => { try { fn(u); } catch { /* gone */ } }); }); }
      catch (ex) {
        // Stream hiccup → small clips still fit the plain-storage path.
        if (file.size <= 50 * 1024 * 1024) att = await uploadAttachment(file, folder);
        else throw ex;
      }
      u.att = att; u.status = "done";
    } catch (ex) { u.status = "failed"; u.error = ex.message || "Upload failed"; }
    settle(uploadId);
  })();
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

// A contractor_messages row was saved carrying this placeholder — patch that row
// in place when the upload settles (works from the portal and the admin side;
// RLS already lets each sender update their own thread's rows). The realtime
// subscription every client holds re-renders the bubble automatically.
export function bindCtrVideoMessage(uploadId, msgId) {
  const u = uploads[uploadId];
  if (!u) return;
  const apply = async (att) => {
    try {
      const { data } = await supabase.from("contractor_messages").select("id,data,org_id").eq("id", String(msgId)).single();
      const msg = data && data.data;
      if (!msg || !msg.attachment || msg.attachment.uploadId !== uploadId || !msg.attachment.pending) return;
      await supabase.from("contractor_messages").upsert(
        { id: String(msgId), org_id: data.org_id, data: { ...msg, attachment: att }, updated_at: new Date().toISOString() },
        { onConflict: "id" }
      );
    } catch { /* best-effort — the bubble stays "uploading" and the sender can resend */ }
  };
  if (u.status === "uploading") u.ctrBinds.push(apply);
  else apply(finalAtt(u));
}

// Live state for a local upload (null once the app was reopened — the manager
// only lives as long as the page).
export function useVideoUpload(uploadId) {
  const [state, setState] = useState(() => { const u = uploadId && uploads[uploadId]; return u ? { pct: u.pct, status: u.status } : null; });
  useEffect(() => {
    const u = uploadId && uploads[uploadId];
    if (!u) { setState(null); return; }
    const fn = () => setState({ pct: u.pct, status: u.status });
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
  const stale = att.pending && !live && att.startedAt && (Date.now() - new Date(att.startedAt).getTime()) > 2 * 3600000;
  const failed = att.failed || (live && live.status === "failed") || stale;
  return (
    <div style={{ marginTop: 6, width: "min(240px,64vw)", padding: "10px 12px", borderRadius: 10, background: mine ? "rgba(255,255,255,0.15)" : T.bg, border: `1px solid ${mine ? "rgba(255,255,255,0.3)" : T.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18, flexShrink: 0 }}>{failed ? "⚠️" : "🎬"}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: failed ? (mine ? "#fff" : T.red) : fg }}>
            {failed ? "Video didn't upload" : live ? `Uploading video… ${live.pct || 0}%` : "Video on its way…"}
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
