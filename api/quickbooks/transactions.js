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

    const items = [];
    function walk(rows) {
      if (!rows) return;
      for (const r of rows) {
        if (r.ColData) {
          const g = (i) => (i >= 0 ? r.ColData[i]?.value : "") || "";
          const account = g(iAcct);
          if (account) items.push({
            date: g(iDate),
            type: g(iType),
            num: g(iNum),
            vendor: g(iName),
            memo: g(iMemo),
            account,
            amount: num(g(iAmt)),
          });
        }
        if (r.Rows?.Row) walk(r.Rows.Row);
      }
    }
    walk(rpt.Rows?.Row);
    res.status(200).json({ items });
  } catch (e) {
    console.error("[quickbooks] transactions failed:", e.message);
    res.status(500).json({ error: e.message });
  }
}
