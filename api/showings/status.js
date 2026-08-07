import { requireAppUser, isAdminUser, getFeeds } from "../../lib/showings.js";

export default async function handler(req, res) {
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  try {
    const feeds = await getFeeds();
    // Reveal the saved links to admins only. A failing admin check must never flip
    // "configured" off (which would wrongly show the Connect screen).
    let admin = false;
    try { admin = await isAdminUser(user.id); } catch { admin = false; }
    res.status(200).json({
      configured: feeds.length > 0,
      icsUrl: admin ? (feeds[0]?.url || "") : undefined,          // legacy clients
      feeds: admin ? feeds.map((f) => ({ id: f.id, url: f.url, label: f.label || "" })) : undefined,
    });
  } catch (e) {
    res.status(200).json({ configured: false, error: e.message });
  }
}
