// Cloudflare Stream — big videos for team chat and the contractor portal.
// POST → mint a one-time direct-upload URL (the phone uploads straight to
// Cloudflare, never through us). GET ?uid= → the video's playback details once
// uploaded. Any signed-in user (team or contractor login) may upload.
import { requireAppUser } from "../../lib/showings.js";

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_STREAM_TOKEN = process.env.CF_STREAM_TOKEN;
const API = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream`;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const user = await requireAppUser(req);
    if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
    if (!CF_ACCOUNT_ID || !CF_STREAM_TOKEN) { res.status(503).json({ error: "Video service isn't configured yet." }); return; }
    const cf = { Authorization: `Bearer ${CF_STREAM_TOKEN}`, "Content-Type": "application/json" };

    if (req.method === "POST") {
      const name = (req.body && req.body.name) || "video";
      const r = await fetch(`${API}/direct_upload`, {
        method: "POST",
        headers: cf,
        body: JSON.stringify({ maxDurationSeconds: 3600, requireSignedURLs: false, meta: { name: String(name).slice(0, 120), uploadedBy: user.email || user.id } }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.success) { res.status(502).json({ error: j.errors?.[0]?.message || "Couldn't start the video upload." }); return; }
      res.status(200).json({ uploadURL: j.result.uploadURL, uid: j.result.uid });
      return;
    }

    if (req.method === "GET") {
      const uid = String(req.query.uid || "").replace(/[^a-zA-Z0-9]/g, "");
      if (!uid) { res.status(400).json({ error: "Missing uid." }); return; }
      const r = await fetch(`${API}/${uid}`, { headers: cf });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.success) { res.status(502).json({ error: j.errors?.[0]?.message || "Couldn't fetch the video." }); return; }
      const v = j.result || {};
      res.status(200).json({ uid, readyToStream: !!v.readyToStream, preview: v.preview || "", thumbnail: v.thumbnail || "", duration: v.duration || 0 });
      return;
    }

    res.status(405).json({ error: "Method not allowed." });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
