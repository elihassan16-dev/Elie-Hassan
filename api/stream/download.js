// Downloadable MP4s for Cloudflare Stream videos. Stream serves playback as
// HLS (no single file to save), so the first download request asks Cloudflare
// to render an MP4; the app polls this endpoint until it's ready, then saves
// that file to the phone's gallery / computer. Rendering is one-time per video.
import { requireAppUser } from "../../lib/showings.js";

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_STREAM_TOKEN = process.env.CF_STREAM_TOKEN;
const API = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream`;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed." }); return; }
    const user = await requireAppUser(req);
    if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
    if (!CF_ACCOUNT_ID || !CF_STREAM_TOKEN) { res.status(503).json({ error: "Video service isn't configured yet." }); return; }
    const uid = String((req.body || {}).uid || "").replace(/[^a-zA-Z0-9]/g, "");
    if (!uid) { res.status(400).json({ error: "Missing uid." }); return; }
    const cf = { Authorization: `Bearer ${CF_STREAM_TOKEN}`, "Content-Type": "application/json" };
    // POST kicks off (or returns) the MP4 render; if Cloudflare rejects the
    // duplicate create, fall back to reading the existing one.
    let r = await fetch(`${API}/${uid}/downloads`, { method: "POST", headers: cf });
    let j = await r.json().catch(() => ({}));
    if (!r.ok || !j.success) {
      r = await fetch(`${API}/${uid}/downloads`, { headers: cf });
      j = await r.json().catch(() => ({}));
      if (!r.ok || !j.success) { res.status(502).json({ error: j.errors?.[0]?.message || "Couldn't prepare the video download." }); return; }
    }
    const d = (j.result && j.result.default) || {};
    res.status(200).json({ status: d.status || "inprogress", percent: d.percentComplete || 0, url: d.url || "" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
