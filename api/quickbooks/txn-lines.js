import { qbApi, requireAppUser } from "../../lib/quickbooks.js";

// Fetch the full line items (splits) of a single QuickBooks transaction, so the
// client can pin only some lines of a journal entry / bill / check / deposit, etc.
// The P&L detail report only surfaces income/expense lines; this pulls the whole
// entity (including balance-sheet lines like a down payment moving out of a LOC).

// Map the report's txn_type text to the QBO entity name we query.
function entityFor(type) {
  const t = String(type || "").toLowerCase().trim();
  if (t.includes("journal")) return "JournalEntry";
  if (t.includes("bill payment")) return "BillPayment";
  if (t.includes("bill")) return "Bill";
  if (t.includes("vendor credit")) return "VendorCredit";
  if (t.includes("deposit")) return "Deposit";
  if (t.includes("transfer")) return "Transfer";
  if (t.includes("credit card") || t.includes("check") || t.includes("expense") || t.includes("cash")) return "Purchase";
  if (t.includes("invoice")) return "Invoice";
  if (t.includes("sales receipt")) return "SalesReceipt";
  if (t.includes("payment")) return "Payment";
  return null;
}

// Normalize one line of any entity into { account, amount, description, postingType }.
function lineFields(line) {
  const d =
    line.JournalEntryLineDetail ||
    line.AccountBasedExpenseLineDetail ||
    line.DepositLineDetail ||
    line.ItemBasedExpenseLineDetail ||
    line.SalesItemLineDetail ||
    {};
  const account = d.AccountRef?.name || line.ItemRef?.name || d.AccountRef?.value || "";
  return {
    account,
    amount: Number(line.Amount) || 0,
    description: line.Description || "",
    postingType: d.PostingType || "",
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  const id = req.query.id;
  const type = req.query.type;
  if (!id) { res.status(400).json({ error: "Missing transaction id." }); return; }

  const entity = entityFor(type);
  if (!entity) { res.status(200).json({ entity: null, lines: [], note: "Transaction type not splittable." }); return; }

  try {
    const safeId = String(id).replace(/[^0-9]/g, "");
    const data = await qbApi(`/query?query=${encodeURIComponent(`select * from ${entity} where Id = '${safeId}'`)}`);
    const obj = (data.QueryResponse?.[entity] || [])[0];
    if (!obj) { res.status(200).json({ entity, lines: [] }); return; }
    const lines = (obj.Line || [])
      .filter((l) => l.DetailType && l.DetailType !== "SubTotalLineDetail")
      .map((l, i) => ({ ...lineFields(l), lineIdx: i }))
      .filter((l) => l.amount !== 0 || l.account);
    res.status(200).json({ entity, docNumber: obj.DocNumber || "", date: obj.TxnDate || "", lines });
  } catch (e) {
    console.error("[quickbooks] txn-lines failed:", e.message);
    res.status(500).json({ error: e.message });
  }
}
