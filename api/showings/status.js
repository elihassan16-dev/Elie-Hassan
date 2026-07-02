import { requireAppUser, isAdminUser, getIcsUrl } from "../../lib/showings.js";

export default async function handler(req, res) {
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  try {
    const url = await getIcsUrl();
    const admin = await isAdminUser(user.id);
    // Only reveal the saved calendar link to admins (so they can copy/verify it).
    res.status(200).json({ configured: !!url, icsUrl: admin ? (url || "") : undefined });
  } catch (e) {
    res.status(200).json({ configured: false, error: e.message });
  }
}
