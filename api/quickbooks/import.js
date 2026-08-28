import { requireAppUser, admin } from "../../lib/quickbooks.js";

// The CSV-import stand-in (used during the Aug 2026 Intuit quota outage) is
// retired: imported numbers kept fighting the real ones. This endpoint now
// only PURGES whatever that import wrote — the qb_cache rows for transaction
// lists, per-property P&L stand-ins, and GL entries. It never touches
// properties (pins, exclusions, manual lists live there), the accounts
// cache, or the client seed — those hold last LIVE data.
const PURGE_PREFIXES = ["qb_cache_txns_all_", "qb_cache_txns_cust_", "qb_cache_pnl_", "qb_cache_atx_"];

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only." }); return; }
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || !body.purge) { res.status(410).json({ error: "The spreadsheet import has been removed." }); return; }
  try {
    const db = admin();
    let removed = 0;
    for (const p of PURGE_PREFIXES) {
      const { data } = await db.from("app_settings").select("id").like("id", p.replace(/_/g, "\\_") + "%");
      const ids = (data || []).map((r) => r.id);
      if (!ids.length) continue;
      const { error } = await db.from("app_settings").delete().in("id", ids);
      if (error) throw error;
      removed += ids.length;
    }
    res.status(200).json({ removed });
  } catch (e) {
    console.error("[quickbooks] purge failed:", e.message);
    res.status(500).json({ error: e.message });
  }
}
