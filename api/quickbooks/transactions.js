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
  // customerId optional: with it → one project's P&L detail; without it → the
  // WHOLE company's (the Cash Flow report). Optional start=YYYY-MM-DD bounds
  // the range (default: everything).
  const customerId = req.query.customerId || "";

  const num = (v) => { const x = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isNaN(x) ? 0 : x; };
  try {
    const start = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.start || "")) ? req.query.start : "2010-01-01";
    const end = new Date().toISOString().slice(0, 10);
    const rpt = await qbApi(
      `/reports/ProfitAndLossDetail?${customerId ? `customer=${encodeURIComponent(customerId)}&` : ""}start_date=${start}&end_date=${end}&columns=tx_date,txn_type,doc_num,name,memo,cust_name,subt_nat_amount`
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
    const iCust = idx("cust_name", "cust");

    // Transactions are grouped under their P&L account. Each Section's Header holds
    // the account name; carry it down to the transaction rows beneath it. Nested
    // groups (e.g. "Cost of Goods Sold" → "Rehab Costs") overwrite as we descend,
    // so each transaction ends up tagged with its leaf account.
    const items = [];
    const sectionName = (r, fallback) => (r.Header?.ColData ? (r.Header.ColData[0]?.value || fallback) : fallback);
    // Track BOTH the leaf account (deepest group, e.g. "Rental Income") and the
    // top-level P&L section (e.g. "Income" / "Expenses" / "Cost of Goods Sold"), so
    // the client can classify by section (income → rent) even when an income account
    // name doesn't contain an obvious keyword.
    // Only REAL P&L sections may set a branch's section — matched by the row's
    // machine group OR its header text against an explicit whitelist. Summary
    // wrappers ("Net Operating Income"…) and unknown groups inherit instead,
    // so expenses can never masquerade as income (and income never vanishes).
    const SEC_BY_GROUP = { Income: "Income", COGS: "COGS", Expenses: "Expenses", OtherIncome: "OtherIncome", OtherExpenses: "OtherExpenses" };
    const SEC_BY_HEADER = { "income": "Income", "total income": "Income", "cost of goods sold": "COGS", "expenses": "Expenses", "other income": "OtherIncome", "other expenses": "OtherExpenses", "other expense": "OtherExpenses" };
    function walk(rows, account, section) {
      if (!rows) return;
      for (const r of rows) {
        const acct = sectionName(r, account);
        const header = r.Header?.ColData ? r.Header.ColData[0]?.value || "" : "";
        const sec = SEC_BY_GROUP[r.group] || SEC_BY_HEADER[String(header).trim().toLowerCase()] || section;
        if (r.ColData) {
          const g = (i) => (i >= 0 ? r.ColData[i]?.value : "") || "";
          const date = g(iDate), type = g(iType), vendor = g(iName);
          // A real transaction line has a date/type/vendor (not a bare subtotal).
          if (acct && (date || type || vendor)) {
            // The tx_date cell carries the transaction's Id in detail reports; keep it
            // so the client can fetch the full transaction (all splits) on demand.
            const id = r.ColData[iDate >= 0 ? iDate : 0]?.id || r.ColData.find((c) => c && c.id)?.id || "";
            items.push({ id, date, type, num: g(iNum), vendor, memo: g(iMemo), project: g(iCust), account: acct, section: sec, amount: num(g(iAmt)) });
          }
        }
        if (r.Rows?.Row) walk(r.Rows.Row, acct, sec);
      }
    }
    walk(rpt.Rows?.Row, "", "");

    // ── Project attribution for the company-wide report ──────────────────────
    // QBO's ProfitAndLossDetail NEVER fills a customer column on the whole-
    // company run (known API limitation) — but the SAME report filtered to one
    // customer works (the property pages rely on it). So: list the projects,
    // run the report per project in parallel, and stamp each company line with
    // its project by matching transaction id + amount. A split check appears in
    // two projects' reports with each project's own slice, so splits map
    // per-line for free. Best-effort: attribution failures leave "No project".
    if (!customerId && items.length) {
      try {
        const pj = await qbApi(`/query?query=${encodeURIComponent("select Id, DisplayName, Job, ParentRef from Customer where Active in (true, false) maxresults 1000")}`);
        // Parents first, then sub-customers/projects — a line inside a project is
        // stamped by both passes and the more specific (project) name wins.
        const projects = (pj.QueryResponse?.Customer || [])
          .map((c) => ({ id: c.Id, name: c.DisplayName, sub: !!(c.Job || c.ParentRef) }))
          .sort((a, b) => (a.sub ? 1 : 0) - (b.sub ? 1 : 0))
          .slice(0, 120);
        const alloc = new Map(); // `${txnId}|${amount}` → project name
        const one = async (proj) => {
          try {
            const r = await qbApi(
              `/reports/ProfitAndLossDetail?customer=${encodeURIComponent(proj.id)}&start_date=${start}&end_date=${end}&columns=tx_date,txn_type,doc_num,name,memo,subt_nat_amount`
            );
            const pc = (r.Columns?.Column || []).map((c) => { const m = (c.MetaData || []).find((x) => x.Name === "ColKey"); return (m?.Value || c.ColType || c.ColTitle || "").toLowerCase(); });
            const pAmt = pc.findIndex((c) => c.includes("subt_nat_amount") || c.includes("nat_amount") || c.includes("amount"));
            const pDate = pc.findIndex((c) => c.includes("tx_date") || c.includes("date"));
            (function w(rows) {
              if (!rows) return;
              for (const row of rows) {
                if (row.ColData) {
                  const id = row.ColData[pDate >= 0 ? pDate : 0]?.id || row.ColData.find((c) => c && c.id)?.id || "";
                  const amt = num(pAmt >= 0 ? row.ColData[pAmt]?.value : "");
                  if (id) alloc.set(`${id}|${amt}`, proj.name);
                }
                if (row.Rows?.Row) w(row.Rows.Row);
              }
            })(r.Rows?.Row);
          } catch { /* one project failing shouldn't sink the search */ }
        };
        // modest concurrency — dozens of projects stay well inside the timeout
        const t0 = Date.now();
        for (let i = 0; i < projects.length; i += 8) {
          if (Date.now() - t0 > 6500) break; // stay well inside the function timeout — partial attribution beats a 500
          await Promise.all(projects.slice(i, i + 8).map(one));
        }
        for (const t of items) { if (!t.project) { const hit = alloc.get(`${t.id}|${t.amount}`); if (hit) t.project = hit; } }
      } catch (e) { console.error("[quickbooks] project attribution skipped:", e.message); }
    }

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
