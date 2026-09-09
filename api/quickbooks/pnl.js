import { qbApi, requireTeamUser, qbCached, qbMaxAge } from "../../lib/quickbooks.js";

// Profit & Loss for a single QuickBooks project/customer — flattened to rows.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0"); // always return live numbers
  const user = await requireTeamUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  const customerId = req.query.customerId;
  if (!customerId) { res.status(400).json({ error: "Missing customerId." }); return; }

  const num = (v) => { const x = parseFloat(String(v ?? "").replace(/,/g, "")); return isNaN(x) ? 0 : x; };
  try {
    const start = "2010-01-01";
    const end = new Date().toISOString().slice(0, 10);
    // Stored data is the truth; how long it stays good depends on which stage
    // the property is at (Elie 9/1, per-status 9/8). The client sends the tier
    // from the property's status: "day" for Under Construction, "slow" for
    // Purchased / On Market / In Closing (about 3x a week), "sold" for past
    // deals. A manual ↻ (fresh=1) bypasses all of it. Under Contract, Sold and
    // Rental are not shown in the financial section, so the client never asks.
    // Windows are calendar mornings in Eastern time, not rolling hours:
    // "day" = pulled since 5 AM today, "slow" = since 5 AM yesterday (Elie 9/9).
    const ttl = qbMaxAge(req.query.tier, req.query.fresh === "1");
    const { data: rpt, cachedAt, stale } = await qbCached(`pnl_${customerId}`, ttl, () => qbApi(
      `/reports/ProfitAndLoss?customer=${encodeURIComponent(customerId)}&start_date=${start}&end_date=${end}&accounting_method=Accrual`
    ));

    // An entry imported from a QBO CSV export is already processed — serve it.
    if (rpt && Array.isArray(rpt.rows) && rpt.income !== undefined) {
      res.status(200).json({ ...rpt, cachedAt, stale: true, imported: true });
      return;
    }

    const out = { rows: [], income: 0, cogs: 0, expenses: 0, netIncome: 0 };
    function walk(rows, section) {
      if (!rows) return;
      for (const r of rows) {
        const grp = r.group || section;
        // leaf account line
        if (r.type === "Data" && r.ColData) {
          const name = r.ColData[0]?.value;
          const amount = num(r.ColData[r.ColData.length - 1]?.value);
          if (name) out.rows.push({ name, amount, section: grp || "" });
        }
        if (r.Rows?.Row) walk(r.Rows.Row, grp);
        if (r.Summary?.ColData && r.group) {
          const t = num(r.Summary.ColData[r.Summary.ColData.length - 1]?.value);
          if (r.group === "Income") out.income = t;
          else if (r.group === "COGS") out.cogs = t;
          else if (r.group === "Expenses") out.expenses = t;
          else if (r.group === "NetIncome") out.netIncome = t;
        }
      }
    }
    walk(rpt.Rows?.Row, null);
    res.status(200).json({ ...out, cachedAt, stale: !!stale });
  } catch (e) {
    console.error("[quickbooks] pnl failed:", e.message);
    res.status(500).json({ error: e.message });
  }
}
