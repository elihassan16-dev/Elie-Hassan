import { requireAppUser, isAdminUser, setIcsUrl, getFeeds, setFeeds } from "../../lib/showings.js";

const looksLikeIcs = (u) => /^(webcal|https?):\/\//i.test(u);

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed." }); return; }
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  if (!(await isAdminUser(user.id))) { res.status(403).json({ error: "Only an admin can connect ShowingTime." }); return; }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    // Add a second (third…) calendar next to the existing ones.
    if (body.addUrl) {
      const url = String(body.addUrl).trim();
      if (!looksLikeIcs(url)) { res.status(400).json({ error: "That doesn't look like a calendar link (should start with webcal:// or https://)." }); return; }
      const feeds = await getFeeds();
      if (feeds.some((f) => f.url === url)) { res.status(400).json({ error: "That calendar is already connected." }); return; }
      const label = String(body.label || "").trim() || `Calendar ${feeds.length + 1}`;
      await setFeeds([...feeds, { id: String(Date.now()), url, label }]);
      res.status(200).json({ ok: true });
      return;
    }

    // Remove one calendar by id (the rest keep syncing).
    if (body.removeId) {
      const feeds = await getFeeds();
      const next = feeds.filter((f) => String(f.id) !== String(body.removeId));
      if (next.length === feeds.length) { res.status(400).json({ error: "Calendar not found." }); return; }
      await setFeeds(next);
      res.status(200).json({ ok: true });
      return;
    }

    // Legacy / first connect: one link replaces the whole list.
    const icsUrl = (body.icsUrl || "").trim();
    if (!looksLikeIcs(icsUrl)) { res.status(400).json({ error: "That doesn't look like a calendar link (should start with webcal:// or https://)." }); return; }
    await setIcsUrl(icsUrl);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
