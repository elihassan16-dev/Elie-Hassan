import { qbApi, requireAppUser } from "../../lib/quickbooks.js";

// List the transactions posted to a single QuickBooks ACCOUNT (e.g. a construction
// mortgage / loan liability), so the app can pin individual draws against it. The
// ProfitAndLossDetail feed only surfaces P&L lines; loan draws are balance-sheet
// entries, so we use the General Ledger report filtered to the one account.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  const account = req.query.account;
  if (!account) { res.status(400).json({ error: "Missing account id." }); return; }

  const num = (v) => { const x = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isNaN(x) ? 0 : x; };
  try {
    const start = "2010-01-01";
    const end = new Date().toISOString().slice(0, 10);
    const rpt = await qbApi(
      `/reports/GeneralLedger?account=${encodeURIComponent(account)}&start_date=${start}&end_date=${end}&columns=tx_date,txn_type,doc_num,name,memo,subt_nat_amount`
    );

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
    // Prefer the transaction amount column; never the running "balance" column.
    let iAmt = idx("subt_nat_amount", "nat_amount");
    if (iAmt < 0) iAmt = cols.findIndex((c) => c.includes("amount") && !c.includes("balance"));

    const items = [];
    function walk(rows) {
      if (!rows) return;
      for (const r of rows) {
        if (r.ColData) {
          const g = (i) => (i >= 0 ? r.ColData[i]?.value : "") || "";
          const date = g(iDate), type = g(iType), vendor = g(iName);
          // A real transaction row has a date or type (not a bare account subtotal).
          if (date || type) {
            const id = r.ColData[iDate >= 0 ? iDate : 0]?.id || r.ColData.find((c) => c && c.id)?.id || "";
            items.push({ id, date, type, num: g(iNum), vendor, memo: g(iMemo), amount: num(g(iAmt)) });
          }
        }
        if (r.Rows?.Row) walk(r.Rows.Row);
      }
    }
    walk(rpt.Rows?.Row);

    if (req.query.debug) {
      res.status(200).json({ cols, indexes: { iDate, iType, iNum, iName, iMemo, iAmt }, parsedCount: items.length, sample: items.slice(0, 5) });
      return;
    }
    res.status(200).json({ items });
  } catch (e) {
    console.error("[quickbooks] account-txns failed:", e.message);
    res.status(500).json({ error: e.message });
  }
}
