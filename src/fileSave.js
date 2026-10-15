// Save / Share a photo, video or file as the REAL file — never the raw storage
// link (Elie 10/15/26: saving opened a supabase.co link or downloaded a broken
// "file.json"; sharing to WhatsApp sent a link instead of the video).
//   • Save  — phone: the share sheet with the file ("Save Image/Video" → Photos,
//             "Save to Files" for PDFs); computer: a normal download with a real
//             file name.
//   • Share — the share sheet with the file itself (WhatsApp, Messages, Mail…);
//             a computer without file sharing gets the download instead.
// Stream videos have no file until Cloudflare renders the MP4: we ask for it,
// wait until it's ready, then pull it through our own domain (/api/stream/file).
// iOS only lets the share sheet open right after a tap — when preparing took
// too long, the files are kept and the next tap opens the sheet instantly.
import { qbAuthFetch } from "./net";

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/quicktime": "mov", "application/pdf": "pdf", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/webm": "webm" };
export const isPhone = () => typeof navigator !== "undefined" && (/iphone|ipad|ipod|android/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

// Every file in an item: a photo grid has several, everything else one.
const partsOf = (item) => (item && item.kind === "images" && Array.isArray(item.items) ? item.items.map((it) => ({ ...it, kind: "image" })) : item ? [item] : []);
const keyOf = (item) => partsOf(item).map((x) => x.uid || x.url).join("|");
const cache = new Map(); // key → File[] (ready for the next tap)

function nameFor(x, type) {
  let n = String(x.name || "").trim();
  if (!n) { try { n = decodeURIComponent(new URL(x.url, location.href).pathname.split("/").pop() || ""); } catch { n = ""; } n = n.replace(/^\d{10,}-[a-z0-9]+-/i, ""); }
  if (!n) n = x.kind === "image" ? "photo" : x.kind === "video" ? "video" : "file";
  if (!/\.[a-z0-9]{2,5}$/i.test(n)) { const e = EXT[String(type || "").split(";")[0]] || (x.kind === "image" ? "jpg" : x.kind === "video" ? "mp4" : ""); if (e) n += "." + e; }
  return n.replace(/[\\/:*?"<>|]+/g, "-");
}

async function streamFileUrl(x, onStatus) {
  onStatus("Preparing video…");
  for (let i = 0; i < 70; i++) {
    const d = await qbAuthFetch("/api/stream/download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid: x.uid }) });
    if (d && d.status === "ready" && d.url) {
      const base = String(x.name || "video").replace(/\.[a-z0-9]+$/i, "");
      return `/api/stream/file?uid=${encodeURIComponent(x.uid)}&name=${encodeURIComponent(base)}`;
    }
    onStatus(`Preparing video… ${(d && d.percent) || 0}%`);
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error("The video is still being prepared — try again in a minute.");
}

async function filesFor(item, onStatus) {
  const k = keyOf(item);
  if (cache.has(k)) return cache.get(k);
  const out = [];
  for (const x of partsOf(item)) {
    let url = x.url;
    if (x.kind === "video" && x.uid) url = await streamFileUrl(x, onStatus);
    onStatus(x.kind === "video" ? "Downloading video…" : "Getting the file…");
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Couldn't download it (${r.status}) — try again.`);
    const blob = await r.blob();
    const type = (x.mime && !/octet-stream/.test(x.mime) ? x.mime : "") || blob.type || "application/octet-stream";
    out.push(new File([blob], nameFor(x, type), { type }));
  }
  cache.set(k, out);
  setTimeout(() => cache.delete(k), 10 * 60 * 1000);
  return out;
}

function download(files) {
  files.forEach((f, i) => setTimeout(() => {
    const u = URL.createObjectURL(f);
    const a = document.createElement("a");
    a.href = u; a.download = f.name; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 60000);
  }, i * 350));
}

const canShareFiles = (files) => { try { return !!(navigator.canShare && navigator.canShare({ files })); } catch { return false; } };

// → "done" | "downloaded" | "cancel" | "again" (tap once more to open the share sheet)
async function shareOrSave(item, onStatus, mode) {
  const files = await filesFor(item, onStatus);
  const sheet = mode === "share" || isPhone();
  if (sheet && canShareFiles(files)) {
    try { await navigator.share({ files }); return "done"; }
    catch (e) {
      if (e && e.name === "AbortError") return "cancel";
      if (e && e.name === "NotAllowedError") return "again"; // the tap "expired" while preparing
      throw e;
    }
  }
  download(files);
  return mode === "share" ? "downloaded" : "done";
}
export const saveItem = (item, onStatus = () => {}) => shareOrSave(item, onStatus, "save");
export const shareItem = (item, onStatus = () => {}) => shareOrSave(item, onStatus, "share");
