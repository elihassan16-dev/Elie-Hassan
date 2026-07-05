import { qbApi, requireAppUser } from "../../lib/quickbooks.js";

// Lists QuickBooks liability accounts (line of credit, hard-money notes, mortgages)
// with their live CurrentBalance, so a property can be linked to the loan accounts
// financing it and we can total the active debt.
export default async function handler(req, res) {
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  const num = (v) => { const x = parseFloat(String(v ?? "").replace(/,/g, "")); return isNaN(x) ? 0 : x; };
  try {
    const q = "select Id, Name, FullyQualifiedName, AccountType, AccountSubType, CurrentBalance, Classification from Account maxresults 1000";
    const data = await qbApi(`/query?query=${encodeURIComponent(q)}`);
    const items = (data.QueryResponse?.Account || [])
      .filter((a) => a.Classification === "Liability")
      .map((a) => ({
        id: a.Id,
        name: a.FullyQualifiedName || a.Name,
        type: a.AccountType || "",
        subType: a.AccountSubType || "",
        balance: num(a.CurrentBalance),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.status(200).json({ items });
  } catch (e) {
    console.error("[quickbooks] accounts failed:", e.message);
    res.status(500).json({ error: e.message });
  }
}
