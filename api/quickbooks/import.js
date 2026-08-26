import { requireAppUser, qbCacheSet, qbCacheGet } from "../../lib/quickbooks.js";

// While Intuit's monthly cap has the API blocked, QuickBooks Online itself
// still works — so a report exported from the QBO website can stand in for
// live data. The client parses the export and posts ready-made cache entries
// here; they land in the same qb_cache_* rows the endpoints already serve
// stale-on-error, so every screen lights up with the imported numbers.
const KEY_OK = /^(txns_all_|txns_cust_|pnl_|atx_|accounts)[\w.\-]*$/;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only." }); return; }
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
  const entries = (body && body.entries) || [];
  if (!Array.isArray(entries) || !entries.length) { res.status(400).json({ error: "Nothing to import." }); return; }
  if (entries.length > 400) { res.status(400).json({ error: "Too many entries." }); return; }
  try {
    let stored = 0;
    for (const e of entries) {
      if (!e || typeof e.key !== "string" || !KEY_OK.test(e.key) || e.data == null) continue;
      // Large lists arrive in chunks: the first write replaces, the rest append.
      if (e.append && Array.isArray(e.data)) {
        const prev = await qbCacheGet(e.key);
        const base = prev && Array.isArray(prev.data) ? prev.data : [];
        await qbCacheSet(e.key, base.concat(e.data));
      } else await qbCacheSet(e.key, e.data);
      stored++;
    }
    res.status(200).json({ stored });
  } catch (e) {
    console.error("[quickbooks] import failed:", e.message);
    res.status(500).json({ error: e.message });
  }
}
