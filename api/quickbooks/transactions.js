import { qbApi, requireAppUser } from "../../lib/quickbooks.js";

// Transaction-level detail for a single QuickBooks project/customer, grouped by
// the P&L account (Purchase Price, Rehab Costs, etc.) so the app can drill into a
// cost bucket and list each transaction.
//
// We use the ProfitAndLossDetail report — it honours the customer filter (like the
// P&L summary already does) and nests each transaction under its income/expense
// account, which is the axis the breakdown buckets are keyed on. TransactionList
// was wrong here: it ignored the customer filter and its "account" column is the
// bank account the money moved through, not the cost category.
export default async function handler(req, res) {
  // Never let the browser cache this — otherwise a stale/empty result sticks (304).
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  const customerId = req.query.customerId;
  if (!customerId) { res.status(400).json({ error: "Missing customerId." }); return; }

  const num = (v) => { const x = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isNaN(x) ? 0 : x; };
  try {
    const start = "2010-01-01";
    const end = new Date().toISOString().slice(0, 10);
    const rpt = await qbApi(
      `/reports/ProfitAndLossDetail?customer=${encodeURIComponent(customerId)}&start_date=${start}&end_date=${end}&columns=tx_date,txn_type,doc_num,name,memo,subt_nat_amount`
    );

    // Map each column to a lowercase key from its metadata (fall back to title).
    const cols = (rpt.Columns?.Column || []).map((c) => {
      const meta = (c.MetaData || []).find((m) => m.Name === "ColKey");
      return (meta?.Value || c.ColType || c.ColTitle || "").toLowerCase();
    });
    const idx = (...keys) => cols.findIndex((c) => keys.some((k) => c.includes(k)));
    const iDate = idx("tx_date", "date");
    const iType = idx("txn_type", "type");
    const iNum = idx("doc_num", "num");
    const iName = idx("name");
    const iMemo = idx("memo");
    const iAmt = idx("subt_nat_amount", "nat_amount", "amount");

    // Transactions are grouped under their P&L account. Each Section's Header holds
    // the account name; carry it down to the transaction rows beneath it. Nested
    // groups (e.g. "Cost of Goods Sold" → "Rehab Costs") overwrite as we descend,
    // so each transaction ends up tagged with its leaf account.
    const items = [];
    const sectionName = (r, fallback) => (r.Header?.ColData ? (r.Header.ColData[0]?.value || fallback) : fallback);
    function walk(rows, account) {
      if (!rows) return;
      for (const r of rows) {
        const acct = sectionName(r, account);
        if (r.ColData) {
          const g = (i) => (i >= 0 ? r.ColData[i]?.value : "") || "";
          const date = g(iDate), type = g(iType), vendor = g(iName);
          // A real transaction line has a date/type/vendor (not a bare subtotal).
          if (acct && (date || type || vendor)) {
            items.push({ date, type, num: g(iNum), vendor, memo: g(iMemo), account: acct, amount: num(g(iAmt)) });
          }
        }
        if (r.Rows?.Row) walk(r.Rows.Row, acct);
      }
    }
    walk(rpt.Rows?.Row, "");

    // Temporary diagnostic: ?debug=1 shows the report shape + per-account counts.
    if (req.query.debug) {
      res.status(200).json({
        cols, indexes: { iDate, iType, iNum, iName, iMemo, iAmt },
        topLevelRowCount: (rpt.Rows?.Row || []).length,
        parsedCount: items.length,
        byAccount: items.reduce((m, t) => { m[t.account] = (m[t.account] || 0) + 1; return m; }, {}),
        sampleRows: (rpt.Rows?.Row || []).slice(0, 2),
        items: items.slice(0, 5),
      });
      return;
    }

    res.status(200).json({ items });
  } catch (e) {
    console.error("[quickbooks] transactions failed:", e.message);
    res.status(500).json({ error: e.message });
  }
}
