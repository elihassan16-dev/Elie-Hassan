// ── Media — one folder per property, in the cloud (Elie 9/10) ────────────────
// Videos live on Cloudflare Stream, photos in the attachments bucket. Each
// property row keeps a small list (`media`) of what was added here directly.
// Anything a contractor sent in the portal chat, or the team sent in a
// property's chat or task threads, shows up in the same folder automatically:
// those are DERIVED from the messages every time (nothing copied), so they
// can never fall out of sync, and `mediaHidden` remembers the ones Elie took
// out of the folder. No React in here - the walkthrough imports it too.
import { uploadAttachment, uploadStreamVideo, qbAuthFetch } from "./net";

const isMedia = (att) => att && (att.kind === "image" || att.kind === "video" || att.kind === "images");

const fromAtt = (att, base) => {
  if (!att) return [];
  if (att.kind === "images") return (att.items || []).map((x, i) => fromAtt({ ...x, kind: "image" }, { ...base, id: base.id + ":" + i })).flat();
  if (!isMedia(att)) return [];
  const video = att.kind === "video";
  return [{
    ...base,
    kind: video ? "video" : "photo",
    url: att.url || "",
    thumb: video ? (att.thumbnail || "") : (att.url || ""),
    uid: video && att.stream ? att.uid : undefined,
    stream: !!att.stream,
    name: att.name || (video ? "video" : "photo"),
    mime: att.mime || "",
  }];
};

// Everything in a property's folder, newest first.
export function mediaOf(property, ctrJobs = [], ctrMessages = []) {
  if (!property) return [];
  const hidden = new Set(property.mediaHidden || []);
  const out = [];
  (property.media || []).forEach((m) => { if (m && m.id && !hidden.has(m.id)) out.push({ ...m, src: m.src || "app" }); });
  (property.messages || []).forEach((m) => fromAtt(m.attachment, { id: "pm:" + m.id, at: Date.parse(m.at) || 0, by: m.author || "", src: "chat" }).forEach((e) => { if (!hidden.has(e.id)) out.push(e); }));
  (property.tasks || []).forEach((t) => (t.messages || []).forEach((m) => fromAtt(m.attachment, { id: "tm:" + t.id + ":" + m.id, at: Date.parse(m.at) || 0, by: m.author || "", src: "chat", note: t.text || "" }).forEach((e) => { if (!hidden.has(e.id)) out.push(e); })));
  const jobIds = new Set((ctrJobs || []).filter((j) => j && String(j.propertyId) === String(property.id)).map((j) => String(j.id)));
  if (jobIds.size) (ctrMessages || []).forEach((m) => {
    if (!m || !jobIds.has(String(m.jobId)) || m.side !== "contractor") return;
    fromAtt(m.attachment, { id: "cm:" + m.id, at: Date.parse(m.at) || 0, by: m.author || "Contractor", src: "contractor" }).forEach((e) => { if (!hidden.has(e.id)) out.push(e); });
  });
  const punch = property.mediaPunch || {};
  return out.map((e) => (punch[e.id] && !e.punchAt ? { ...e, punchAt: punch[e.id] } : e)).sort((a, b) => (b.at || 0) - (a.at || 0));
}

export const mediaCounts = (list) => ({ photos: list.filter((m) => m.kind === "photo").length, videos: list.filter((m) => m.kind === "video").length, last: list.length ? list[0].at : 0 });

export const fmtMB = (n) => (!n ? "" : n >= 1024 * 1024 * 1024 ? (n / 1024 / 1024 / 1024).toFixed(1) + " GB" : Math.max(1, Math.round(n / 1024 / 1024)) + " MB");
export const fmtDur = (s) => { if (!s) return ""; s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// Upload files into a property's folder. onProgress({i, n, pct, name}).
// updateProp(id, key, value) is the property writer; getLatest() hands back the
// freshest property row so a long upload never overwrites what another
// device added meanwhile.
export async function uploadToMedia(property, files, { updateProp, getLatest, by, src = "upload", onProgress } = {}) {
  const fl = Array.from(files || []).filter(Boolean);
  const added = [];
  for (let i = 0; i < fl.length; i++) {
    const f = fl[i];
    const video = (f.type || "").startsWith("video/");
    onProgress && onProgress({ i: i + 1, n: fl.length, pct: 0, name: f.name || (video ? "video" : "photo") });
    let entry;
    if (video) {
      const up = await uploadStreamVideo(f, (pct) => onProgress && onProgress({ i: i + 1, n: fl.length, pct, name: f.name || "video" }));
      let dur = 0;
      try { const info = await qbAuthFetch(`/api/stream/upload?uid=${encodeURIComponent(up.uid)}`); dur = Number(info && info.duration) || 0; } catch { /* later */ }
      entry = { id: "v:" + up.uid, kind: "video", uid: up.uid, stream: true, url: up.url, watch: up.watch, thumb: up.thumbnail || "", name: f.name || "video", mime: f.type || "video/mp4", size: f.size, dur, at: Date.now(), by: by || "", src };
    } else {
      const att = await uploadAttachment(f, "media");
      onProgress && onProgress({ i: i + 1, n: fl.length, pct: 100, name: f.name || "photo" });
      entry = { id: "p:" + Date.now() + ":" + i, kind: "photo", url: att.url, thumb: att.url, name: att.name || f.name || "photo", mime: att.mime || f.type || "", size: f.size, at: Date.now(), by: by || "", src };
    }
    const latest = (getLatest && getLatest()) || property;
    updateProp(property.id, "media", [...(latest.media || []).filter((m) => m && m.id !== entry.id), entry]);
    added.push(entry);
  }
  return added;
}
