// Heartbeat for the new-showing watcher — hit on a schedule (GitHub Actions,
// every ~5 minutes) so brand-new showings trigger notifications around the
// clock, not just while someone has the app open. Safe without auth: it
// returns nothing sensitive and the watcher itself is throttled internally
// (one real feed check per 4 minutes; notifications only for new showings,
// only to the configured recipients).
import { checkNewShowings } from "../../lib/showings.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const r = await checkNewShowings();
  res.status(200).json({ ok: true, fresh: (r && r.fresh) || 0, skipped: !!(r && r.skipped) });
}
