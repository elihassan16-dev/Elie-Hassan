// Demo-only network layer for the tutorial recording — no Supabase, no API.
export const attachmentKind = (mime = "") => mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "file";
export const sanitizeName = (n = "file") => n;
export const STREAM_VIDEO_CAP = 200 * 1024 * 1024;
export async function notify() { /* demo */ }
export async function uploadAttachment(file) {
  return { url: URL.createObjectURL(file), name: file.name || "file", mime: file.type || "", kind: attachmentKind(file.type || "") };
}
export async function uploadStreamVideo(file) { return uploadAttachment(file); }
export async function qbAuthFetch(path) {
  if (String(path).includes("/api/team/roster")) return { names: ["Elie Hassan", "Esti Unsdorfer", "Moshe Hamaoui"] };
  return { ok: true };
}
