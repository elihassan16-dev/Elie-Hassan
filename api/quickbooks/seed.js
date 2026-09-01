import { requireTeamUser, admin } from "../../lib/quickbooks.js";

// While Intuit's monthly cap has live data paused, devices share their last
// good snapshot through this endpoint: a device that still holds balances and
// project-spend totals donates them (POST), and a device with nothing adopts
// the freshest donated copy (GET) — so every screen shows the same labeled
// "as of" numbers instead of blanks. Stored in a qb_cache_* row, which clients
// never sync directly (excluded by prefix in the DataProvider).
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const user = await requireTeamUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  const db = admin();
  const ROW = "qb_cache_clientseed";
  try {
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
      const { at, accounts, spend } = body || {};
      if (!at || !Array.isArray(accounts) || !accounts.length) { res.status(400).json({ error: "Nothing to seed." }); return; }
      const { data: row } = await db.from("app_settings").select("data").eq("id", ROW).maybeSingle();
      const prev = row && row.data && row.data.hit;
      // Freshest donor wins — never overwrite a newer snapshot with an older one.
      if (!prev || (prev.at || 0) < at) {
        await db.from("app_settings").upsert({ id: ROW, data: { id: ROW, hit: { at, data: { accounts, spend: spend || {} } } } });
        res.status(200).json({ stored: true });
      } else res.status(200).json({ stored: false, newerExists: true });
      return;
    }
    const { data: row } = await db.from("app_settings").select("data").eq("id", ROW).maybeSingle();
    res.status(200).json((row && row.data && row.data.hit) || null);
  } catch (e) {
    console.error("[quickbooks] seed failed:", e.message);
    res.status(500).json({ error: e.message });
  }
}
