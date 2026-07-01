import { qbApi, requireAppUser } from "../../lib/quickbooks.js";

// Profit & Loss for a single QuickBooks project/customer — flattened to rows.
export default async function handler(req, res) {
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  const customerId = req.query.customerId;
  if (!customerId) { res.status(400).json({ error: "Missing customerId." }); return; }

  const num = (v) => { const x = parseFloat(String(v ?? "").replace(/,/g, "")); return isNaN(x) ? 0 : x; };
  try {
    const start = "2010-01-01";
    const end = new Date().toISOString().slice(0, 10);
    const rpt = await qbApi(
      `/reports/ProfitAndLoss?customer=${encodeURIComponent(customerId)}&start_date=${start}&end_date=${end}&accounting_method=Accrual`
    );

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
    res.status(200).json(out);
  } catch (e) {
    console.error("[quickbooks] pnl failed:", e.message);
    res.status(500).json({ error: e.message });
  }
}
