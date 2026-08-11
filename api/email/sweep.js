// Heartbeat for the 24/7 email sweeper — hit on a schedule (the same GitHub
// Actions workflow that pings the showing watcher). Safe without auth: it
// returns only counts (never email content) and throttles itself internally
// (one real sweep per 4 minutes). Until AZURE_CLIENT_SECRET is configured it
// simply reports configured:false and does nothing.
import { sweepMailboxes, mailSweepConfigured } from "../../lib/mailsweep.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.query.status) return res.status(200).json({ configured: mailSweepConfigured() });
  try {
    // ?rescan=1 → wipe the watermarks and re-scan the last 14 days right now.
    // ?debug=1 → include scan counts + matched addresses (never mail content).
    const r = await sweepMailboxes({ debug: !!req.query.debug, rescan: !!req.query.rescan });
    return res.status(200).json({ ok: true, ...r });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
}
