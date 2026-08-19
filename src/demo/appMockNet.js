// Preview-harness network layer for the MAIN app — no backend, no Supabase.
// qbAuthFetch answers the app's API routes with safe, realistic canned shapes
// so pages render instead of erroring. Aliased in by vite.appdemo.config.js.
export const attachmentKind = (mime = "") => mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "file";
export const sanitizeName = (n = "file") => n;
export const STREAM_VIDEO_CAP = 200 * 1024 * 1024;
export async function notify() { /* preview */ }
export async function compressImage(file) { return file; }
export async function waitStreamReady() { return true; }
export async function uploadAttachment(file) {
  return { url: URL.createObjectURL(file), name: file.name || "file", mime: file.type || "", kind: attachmentKind(file.type || "") };
}
export async function uploadStreamVideo(file) { return uploadAttachment(file); }

export async function qbAuthFetch(path) {
  const p = String(path);
  if (p.includes("/api/showings")) return { configured: true, showings: [] };
  if (p.includes("/api/jivetel/send")) return { connected: true, from: "+17325550100", lines: {} };
  if (p.includes("/api/team/roster")) return { names: ["Elie Hassan", "Moshe Hamaoui", "Esti Ungar"] };
  if (p.includes("/api/quickbooks")) return { connected: false, rows: [], income: 0, cogs: 0, expenses: 0, netIncome: 0 };
  if (p.includes("/api/boldtrail")) return { leads: [] };
  if (p.includes("/api/rentcast")) throw new Error("Preview mode — RentCast runs on the live site.");
  if (p.includes("/api/ai/")) throw new Error("Preview mode — AI runs on the live site.");
  return { ok: true };
}
