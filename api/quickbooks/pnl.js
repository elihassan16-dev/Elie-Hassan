import { qbApi, requireAppUser, qbCached, qbCustomerFamily } from "../../lib/quickbooks.js";

// Profit & Loss for a single QuickBooks project/customer — flattened to rows.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0"); // always return live numbers
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  const customerId = req.query.customerId;
  if (!customerId) { res.status(400).json({ error: "Missing customerId." }); return; }

  const num = (v) => { const x = parseFloat(String(v ?? "").replace(/,/g, "")); return isNaN(x) ? 0 : x; };
  try {
    const start = "2010-01-01";
    const end = new Date().toISOString().slice(0, 10);
    // 15-min shared cache — the BS report re-scans every project on each open.
    const { data: rpt, cachedAt, stale } = await qbCached(`pnl_${customerId}`, req.query.fresh === "1" ? 0 : 15 * 60000, async () => {
      // A property's costs can split between the customer and its project twin
      // (sub-customer): one plain report per family member, merged below. The
      // comma-joined filter form broke on some (inactive) ids and silently
      // collapsed a deal's costs — never again. Extra members are best-effort;
      // only the linked id's own failure propagates.
      const fam = await qbCustomerFamily(customerId).catch(() => [String(customerId)]);
      const parts = [];
      for (const cid of fam) {
        try { parts.push(await qbApi(`/reports/ProfitAndLoss?customer=${encodeURIComponent(cid)}&start_date=${start}&end_date=${end}&accounting_method=Accrual`)); }
        catch (e) { if (String(cid) === String(customerId)) throw e; }
      }
      return parts.length === 1 ? parts[0] : { multi: parts };
    });

    // An entry imported from a QBO CSV export is already processed — serve it.
    if (rpt && Array.isArray(rpt.rows) && rpt.income !== undefined) {
      res.status(200).json({ ...rpt, cachedAt, stale: true, imported: true });
      return;
    }

    const out = { rows: [], income: 0, cogs: 0, expenses: 0, netIncome: 0 };
    const byKey = new Map(); // same account across family members merges into one row
    function walk(rows, section) {
      if (!rows) return;
      for (const r of rows) {
        const grp = r.group || section;
        // leaf account line
        if (r.type === "Data" && r.ColData) {
          const name = r.ColData[0]?.value;
          const amount = num(r.ColData[r.ColData.length - 1]?.value);
          if (name) {
            const k = `${grp || ""}|${name}`;
            const cur = byKey.get(k);
            if (cur) cur.amount += amount; else byKey.set(k, { name, amount, section: grp || "" });
          }
        }
        if (r.Rows?.Row) walk(r.Rows.Row, grp);
        if (r.Summary?.ColData && r.group) {
          const t = num(r.Summary.ColData[r.Summary.ColData.length - 1]?.value);
          if (r.group === "Income") out.income += t;
          else if (r.group === "COGS") out.cogs += t;
          else if (r.group === "Expenses") out.expenses += t;
          else if (r.group === "NetIncome") out.netIncome += t;
        }
      }
    }
    for (const part of Array.isArray(rpt.multi) ? rpt.multi : [rpt]) walk(part.Rows?.Row, null);
    out.rows = [...byKey.values()];
    res.status(200).json({ ...out, cachedAt, stale: !!stale });
  } catch (e) {
    console.error("[quickbooks] pnl failed:", e.message);
    res.status(500).json({ error: e.message });
  }
}
