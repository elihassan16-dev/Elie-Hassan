// Recent Cloudflare Stream uploads — so a walkthrough video the phone sent
// can be put back on a property if its card entry was lost (Elie 9/9: two
// videos sent while the computer was generating a third fell off the list).
// Any signed-in team user; returns the newest 40 with name, size and time.
import { requireTeamUser } from "../../lib/quickbooks.js";

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_STREAM_TOKEN = process.env.CF_STREAM_TOKEN;
const API = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream`;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const user = await requireTeamUser(req);
    if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
    if (!CF_ACCOUNT_ID || !CF_STREAM_TOKEN) { res.status(503).json({ error: "Video service isn't configured yet." }); return; }
    const r = await fetch(`${API}?limit=40`, { headers: { Authorization: `Bearer ${CF_STREAM_TOKEN}` } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.success) { res.status(502).json({ error: j.errors?.[0]?.message || "Couldn't list videos." }); return; }
    const items = (j.result || [])
      .map((v) => ({ uid: v.uid, name: (v.meta && v.meta.name) || "video", size: Number(v.size) || 0, duration: Number(v.duration) || 0, at: Date.parse(v.created) || 0, ready: !!v.readyToStream }))
      .sort((a, b) => b.at - a.at);
    res.status(200).json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
