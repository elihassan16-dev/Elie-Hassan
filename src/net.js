// Shared network helpers — used by the main app and the contractor portal.
import { supabase } from "./supabaseClient";

// Authenticated fetch to our serverless API (sends the Supabase JWT). If the token
// has gone stale (server replies 401 "Not signed in"), refresh the session once and
// retry — otherwise an idle PWA can fail even though the user is still logged in.
export async function qbAuthFetch(path, opts = {}) {
  const call = async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    // no-store so a refresh always pulls live numbers instead of a stale cached copy.
    return fetch(path, { cache: "no-store", ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
  };
  let res = await call();
  if (res.status === 401) {
    try { await supabase.auth.refreshSession(); } catch { /* fall through */ }
    res = await call();
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status}).`);
  return json;
}

// Fire a push + email notification to teammates (by display name). Best-effort:
// never blocks or throws into the UI. The sender is dropped server-side.
// Extra targeting for the contractor portal: {toAdmins:true} notifies every
// Goldstone admin; {toOrg:"<orgId>"} notifies a contractor company's logins.
export async function notify(recipients, { title, body, tag, url, toAdmins, toOrg } = {}) {
  const list = [...new Set((recipients || []).filter(Boolean))];
  if (!list.length && !toAdmins && !toOrg) return;
  try {
    await qbAuthFetch("/api/notify/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipients: list, title, body, url: url || "/", tag, toAdmins: !!toAdmins, toOrg: toOrg || null }),
    });
  } catch { /* notifications are best-effort */ }
}

// ── Chat attachment upload (Supabase Storage "attachments" bucket) ───────────
export const attachmentKind = (mime = "") => mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "file";
export const sanitizeName = (name = "file") => (name.replace(/[^a-zA-Z0-9._-]/g, "_") || "file").slice(-80);
// ── Big videos (Cloudflare Stream) ───────────────────────────────────────────
// Videos skip Supabase storage entirely: we mint a one-time upload URL from our
// API, the phone POSTs the file straight to Cloudflare (with real progress), and
// playback is a Stream iframe — transcoded, so it plays smoothly on any device.
export const STREAM_VIDEO_CAP = 5 * 1024 * 1024 * 1024; // 5 GB via resumable (tus) uploads
const BASIC_CAP = 190 * 1024 * 1024; // single-shot uploads under Cloudflare's 200MB limit
async function streamDetails(uid) {
  let info = null;
  for (let i = 0; i < 10; i++) {
    try { info = await qbAuthFetch(`/api/stream/upload?uid=${encodeURIComponent(uid)}`); } catch { /* retry */ }
    if (info && info.preview) break;
    await new Promise((r) => setTimeout(r, 700));
  }
  return info;
}
export async function uploadStreamVideo(file, onProgress) {
  let uid;
  // The playback URLs live on the video record, which exists as soon as the
  // upload session is minted — fetch them WHILE the bytes go up so the message
  // is ready the instant the upload finishes (no post-upload polling wait).
  let early = null, earlyP = null;
  const prefetch = () => { earlyP = qbAuthFetch(`/api/stream/upload?uid=${encodeURIComponent(uid)}`).then((i) => { early = i; }).catch(() => {}); };
  if (file.size > BASIC_CAP) {
    // Resumable chunks: survives flaky signal, no 200MB ceiling.
    const tus = await import("tus-js-client");
    const start = await qbAuthFetch("/api/stream/upload", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tus: true, size: file.size, name: file.name || "video" }),
    });
    uid = start.uid;
    prefetch();
    await new Promise((resolve, reject) => {
      const up = new tus.Upload(file, {
        uploadUrl: start.uploadURL,
        chunkSize: 52428800, // 50 MiB — multiple of 256 KiB as Stream requires
        retryDelays: [0, 2000, 5000, 10000, 20000],
        metadata: { name: file.name || "video" },
        onProgress: (sent, total) => { if (onProgress) onProgress(Math.min(99, Math.round((sent / total) * 100))); },
        onError: (e) => reject(new Error(e?.message || "Video upload failed — check your connection.")),
        onSuccess: () => resolve(),
      });
      up.start();
    });
  } else {
    const { uploadURL, uid: basicUid } = await qbAuthFetch("/api/stream/upload", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name || "video" }),
    });
    uid = basicUid;
    prefetch();
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", uploadURL);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100))); };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Video upload failed (${xhr.status}).`)));
      xhr.onerror = () => reject(new Error("Video upload failed — check your connection."));
      const fd = new FormData();
      fd.append("file", file);
      xhr.send(fd);
    });
  }
  if (onProgress) onProgress(100);
  // Playback URLs come from the video record (they exist even while it encodes).
  if (earlyP) await earlyP;
  const info = early && early.preview ? early : await streamDetails(uid);
  const watch = info?.preview || "";
  if (!watch) throw new Error("Video uploaded but isn't available yet — try again in a minute.");
  return { kind: "video", stream: true, uid, url: watch.replace(/\/watch$/, "/iframe"), watch, thumbnail: info?.thumbnail || "", name: file.name || "video", mime: file.type || "video/mp4" };
}

// WhatsApp-style photo shrink before upload: a 4–8 MB camera shot becomes a
// few hundred KB at 2048px — uploads AND loads in chats many times faster,
// still plenty sharp to zoom into. Any failure (odd format, old browser)
// returns the original file untouched.
export async function compressImage(file) {
  try {
    if (!file || !(file.type || "").startsWith("image/") || file.size < 400 * 1024) return file;
    if (/gif|svg/.test(file.type)) return file; // animations / vectors — leave alone
    const bmp = await createImageBitmap(file); // browsers bake in EXIF rotation here
    const scale = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size * 0.9) return file; // barely shrank — keep original
    const name = (file.name || "photo").replace(/\.[a-z0-9]+$/i, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch { return file; }
}

// After the bytes land, Cloudflare still has to TRANSCODE the video before its
// player works — swapping the chat bubble to the player too early shows
// "An unknown error occurred" to whoever taps it. Poll until it's actually
// playable (or Cloudflare reports a hard failure). Bounded so a stuck encode
// can't hold the message hostage forever.
export async function waitStreamReady(uid, maxMs = 8 * 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const info = await qbAuthFetch(`/api/stream/upload?uid=${encodeURIComponent(uid)}`);
      if (info && info.readyToStream) return "ready";
      if (info && info.state === "error") return "error";
    } catch { /* transient — keep waiting */ }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return "timeout";
}

export async function uploadAttachment(rawFile, folder = "chat") {
  const file = await compressImage(rawFile);
  const kind = attachmentKind(file.type || "");
  const base = file.name ? sanitizeName(file.name) : `${kind}.${kind === "audio" ? "webm" : kind === "image" ? "jpg" : "bin"}`;
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${base}`;
  const { error } = await supabase.storage.from("attachments").upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from("attachments").getPublicUrl(path);
  return { url: data.publicUrl, name: file.name || base, mime: file.type || "", kind };
}
