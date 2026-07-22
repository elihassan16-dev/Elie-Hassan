// BoldTrail connection check — open like the other status endpoints so it can
// be verified straight from a browser tab. Reports ONLY connection facts:
// which endpoint variant answered, counts, and the API's field names. No lead
// names, phones, or any contact data ever leaves the server here.
import { fetchContacts, normalizeContact, probeDetail } from "../../lib/boldtrail.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const r = await fetchContacts();
  if (!r.configured) { res.status(200).json({ configured: false, hint: "Set BOLDTRAIL_API_TOKEN in Vercel, then redeploy." }); return; }
  if (!r.ok) { res.status(200).json({ configured: true, ok: false, tokenLength: r.tokenLength, tokenLooksJwt: r.tokenLooksJwt, tried: r.tried }); return; }
  const normalized = r.contacts.map(normalizeContact);
  // Probe every candidate detail address for one contact — hashtags live off
  // the list payload, and this shows exactly which door answers with tags.
  const detailProbe = r.contacts[0] ? await probeDetail(normalized[0].id) : [];
  res.status(200).json({
    configured: true, ok: true, endpoint: r.path,
    totalReturned: r.contacts.length,
    buyersInFirstPage: normalized.filter((n) => /buyer/i.test(n.type || "")).length,
    withPhone: normalized.filter((n) => n.phone).length,
    detailProbe,
  });
}
