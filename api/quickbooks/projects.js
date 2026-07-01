import { qbApi, requireAppUser } from "../../lib/quickbooks.js";

// Lists QuickBooks customers + projects (projects are sub-customers) for mapping.
export default async function handler(req, res) {
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  try {
    const q = "select Id, DisplayName, FullyQualifiedName, Job, ParentRef from Customer maxresults 1000";
    const data = await qbApi(`/query?query=${encodeURIComponent(q)}`);
    const rows = (data.QueryResponse?.Customer || []).map((c) => ({
      id: c.Id,
      name: c.FullyQualifiedName || c.DisplayName,
      isProject: !!c.Job,
      parent: c.ParentRef?.name || null,
    }));
    res.status(200).json({ items: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
