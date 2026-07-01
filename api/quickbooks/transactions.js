import { qbApi, requireAppUser } from "../../lib/quickbooks.js";

// Transaction-level detail for a single QuickBooks project/customer, so the app
// can drill into a cost bucket (e.g. Rehab) and list each transaction + vendor.
// Uses the TransactionList report and maps columns by their ColKey metadata so we
// don't depend on fixed column positions (which vary by company file).
export default async function handler(req, res) {
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  const customerId = req.query.customerId;
  if (!customerId) { res.status(400).json({ error: "Missing customerId." }); return; }
  // Never let the browser cache this — otherwise a stale/empty result sticks (304).
  res.setHeader("Cache-Control", "no-store, max-age=0");

  const num = (v) => { const x = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isNaN(x) ? 0 : x; };
  try {
    const start = "2010-01-01";
    const end = new Date().toISOString().slice(0, 10);
    const rpt = await qbApi(
      `/reports/TransactionList?customer=${encodeURIComponent(customerId)}&start_date=${start}&end_date=${end}&columns=tx_date,txn_type,doc_num,name,memo,account_name,subt_nat_amount`
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
    const iAcct = idx("account");
    const iAmt = idx("subt_nat_amount", "nat_amount", "amount");

    // When the report is grouped (e.g. by account), the account name lives in the
    // section Header row and the transaction rows under it leave that column blank.
    // Carry the section's account down so those transactions aren't dropped.
    const headerAccount = (r, fallback) => {
      const h = r.Header?.ColData;
      if (!h) return fallback;
      const fromCol = iAcct >= 0 ? (h[iAcct]?.value || "") : "";
      return fromCol || h[0]?.value || fallback;
    };

    const items = [];
    function walk(rows, sectionAccount) {
      if (!rows) return;
      for (const r of rows) {
        const acct = headerAccount(r, sectionAccount);
        if (r.ColData) {
          const g = (i) => (i >= 0 ? r.ColData[i]?.value : "") || "";
          const account = g(iAcct) || acct || "";
          const date = g(iDate), type = g(iType), vendor = g(iName);
          const amount = num(g(iAmt));
          // A real transaction line has a date/type/vendor (not a bare subtotal).
          if (account && (date || type || vendor)) {
            items.push({ date, type, num: g(iNum), vendor, memo: g(iMemo), account, amount });
          }
        }
        if (r.Rows?.Row) walk(r.Rows.Row, acct);
      }
    }
    walk(rpt.Rows?.Row, "");

    // Temporary diagnostic: /api/quickbooks/transactions?customerId=..&debug=1
    // returns the report's shape so we can see why parsing came up empty.
    if (req.query.debug) {
      res.status(200).json({
        cols, indexes: { iDate, iType, iNum, iName, iMemo, iAcct, iAmt },
        columns: rpt.Columns,
        topLevelRowCount: (rpt.Rows?.Row || []).length,
        sampleRows: (rpt.Rows?.Row || []).slice(0, 3),
        parsedCount: items.length,
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
