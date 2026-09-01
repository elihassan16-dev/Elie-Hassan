import { qbApi, requireAppUser, qbCached } from "../../lib/quickbooks.js";

// Lists QuickBooks customers + projects (projects are sub-customers) for mapping.
export default async function handler(req, res) {
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  try {
    const q = "select Id, DisplayName, FullyQualifiedName, Job, ParentRef from Customer maxresults 1000";
    // Projects barely change — a daily shared cache serves every mapping popup.
    const { data, cachedAt, stale } = await qbCached("projects", req.query.fresh === "1" ? 0 : 24 * 3600000, () => qbApi(`/query?query=${encodeURIComponent(q)}`));
    const rows = (data.QueryResponse?.Customer || []).map((c) => ({
      id: c.Id,
      name: c.FullyQualifiedName || c.DisplayName,
      isProject: !!c.Job,
      parent: c.ParentRef?.name || null,
    }));
    res.status(200).json({ items: rows, cachedAt, stale: !!stale });
  } catch (e) {
    console.error("[quickbooks] projects failed:", e.message);
    res.status(500).json({ error: e.message });
  }
}
