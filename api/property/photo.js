// Street-level photo of an address via the Google Street View Static API, used by
// the Investor Packet cover. Requires GOOGLE_MAPS_API_KEY in Vercel (Street View
// Static API enabled; Google's monthly free credit covers this usage level).
// Returns the image bytes so the browser never sees the API key; 404 when no key
// or no imagery so the packet can simply hide the photo.
export default async function handler(req, res) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const address = String(req.query.address || "").trim();
  if (!key) { res.status(404).json({ error: "No GOOGLE_MAPS_API_KEY configured." }); return; }
  if (!address) { res.status(400).json({ error: "Missing address." }); return; }
  try {
    // Check imagery exists first (metadata calls are free) so we can 404 cleanly.
    const meta = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?size=640x400&location=${encodeURIComponent(address)}&key=${key}`).then((r) => r.json());
    if (!meta || meta.status !== "OK") { res.status(404).json({ error: "No street imagery for this address." }); return; }
    // fov=120 is Street View's widest angle — the most zoomed-out shot available.
    const img = await fetch(`https://maps.googleapis.com/maps/api/streetview?size=640x480&location=${encodeURIComponent(address)}&fov=120&key=${key}`);
    if (!img.ok) { res.status(404).json({ error: "Street View fetch failed." }); return; }
    const buf = Buffer.from(await img.arrayBuffer());
    res.setHeader("Content-Type", img.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.status(200).send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
