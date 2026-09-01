import { qbApi, requireTeamUser, qbCached, qbUsage, QB_LIMIT } from "../../lib/quickbooks.js";

// Lists QuickBooks liability accounts (line of credit, hard-money notes, mortgages)
// with their live CurrentBalance, so a property can be linked to the loan accounts
// financing it and we can total the active debt.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0"); // always return live loan balances
  const user = await requireTeamUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  const num = (v) => { const x = parseFloat(String(v ?? "").replace(/,/g, "")); return isNaN(x) ? 0 : x; };
  try {
    // ?class=Equity → equity accounts (owner distributions); ?class=Bank →
    // bank accounts (to spot the wire-in line of a closing JE); default stays
    // Liability (loan accounts).
    const cls = req.query.class === "Equity" ? "Equity" : req.query.class === "Bank" ? "Bank" : "Liability";
    const q = "select Id, Name, FullyQualifiedName, AccountType, AccountSubType, CurrentBalance, Classification from Account maxresults 1000";
    // 30-minute shared cache (Elie's stored-data rules, 9/1): balances stay
    // same-day fresh without the old every-5-minutes spend; ↻ bypasses.
    const { data, cachedAt, stale } = await qbCached("accounts", req.query.fresh === "1" ? 0 : 30 * 60000, () => qbApi(`/query?query=${encodeURIComponent(q)}`));
    const items = (data.QueryResponse?.Account || [])
      .filter((a) => cls === "Bank" ? a.AccountType === "Bank" : a.Classification === cls)
      .map((a) => ({
        id: a.Id,
        name: a.FullyQualifiedName || a.Name,
        type: a.AccountType || "",
        subType: a.AccountSubType || "",
        balance: num(a.CurrentBalance),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    // The client's usage banner rides along on the poll it already makes.
    const used = await qbUsage().catch(() => 0);
    res.status(200).json({ items, cachedAt, stale: !!stale, usage: { used, limit: QB_LIMIT } });
  } catch (e) {
    console.error("[quickbooks] accounts failed:", e.message);
    res.status(500).json({ error: e.message });
  }
}
