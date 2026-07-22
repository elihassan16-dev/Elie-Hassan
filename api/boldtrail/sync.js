// Heartbeat for the BoldTrail buyer-lead sync — hit on the same GitHub Actions
// schedule as the showing watcher. Tokenless but harmless: returns only counts,
// and without BOLDTRAIL_API_TOKEN configured it does nothing at all.
import { syncBoldtrail } from "../../lib/boldtrail.js";

// Pagination + per-contact tag lookups take real time — allow the full minute.
export const maxDuration = 60;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const r = await syncBoldtrail();
    res.status(200).json({ ok: !!r.ok, configured: r.configured !== false, buyers: r.buyers ?? 0, checked: r.checked ?? 0, fresh: r.fresh ?? 0 });
  } catch (e) {
    console.error("[boldtrail/sync]", e.message);
    res.status(200).json({ ok: false });
  }
}
