import { requireAppUser, isAdminUser, getIcsUrl } from "../../lib/showings.js";

export default async function handler(req, res) {
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  try {
    const url = await getIcsUrl();
    // Reveal the saved link to admins only. A failing admin check must never flip
    // "configured" off (which would wrongly show the Connect screen).
    let admin = false;
    try { admin = await isAdminUser(user.id); } catch { admin = false; }
    res.status(200).json({ configured: !!url, icsUrl: admin ? (url || "") : undefined });
  } catch (e) {
    res.status(200).json({ configured: false, error: e.message });
  }
}
