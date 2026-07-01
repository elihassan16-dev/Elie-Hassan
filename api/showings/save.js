import { requireAppUser, isAdminUser, setIcsUrl } from "../../lib/showings.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed." }); return; }
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  if (!(await isAdminUser(user.id))) { res.status(403).json({ error: "Only an admin can connect ShowingTime." }); return; }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const icsUrl = (body.icsUrl || "").trim();
    if (!/^(webcal|https?):\/\//i.test(icsUrl)) { res.status(400).json({ error: "That doesn't look like a calendar link (should start with webcal:// or https://)." }); return; }
    await setIcsUrl(icsUrl);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
