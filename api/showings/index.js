import { requireAppUser, fetchShowings, checkNewShowings } from "../../lib/showings.js";

export default async function handler(req, res) {
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  try {
    const data = await fetchShowings();
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
    res.status(200).json(data);
    // After responding: ping the configured people about any brand-new showings
    // (throttled inside; reuses the feed we just fetched).
    await checkNewShowings(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
