// BoldTrail connection check (signed-in team only): is the token set, which
// endpoint variant answered, how many contacts came back, how many match the
// buyer+pb-hashtag filter, and what fields the API returns (names only — no
// lead data leaves the server here).
import { requireAppUser } from "../../lib/showings.js";
import { fetchContacts, normalizeContact, isPropertyBuyerLead } from "../../lib/boldtrail.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  const r = await fetchContacts();
  if (!r.configured) { res.status(200).json({ configured: false, hint: "Set BOLDTRAIL_API_TOKEN in Vercel, then redeploy." }); return; }
  if (!r.ok) { res.status(200).json({ configured: true, ok: false, tried: r.tried }); return; }
  const normalized = r.contacts.map(normalizeContact);
  res.status(200).json({
    configured: true, ok: true, endpoint: r.path,
    totalReturned: r.contacts.length,
    matchingBuyerLeads: normalized.filter(isPropertyBuyerLead).length,
    withPhone: normalized.filter((n) => n.phone).length,
    sampleFields: r.sample,
  });
}
