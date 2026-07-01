import { requireAppUser, getIcsUrl } from "../../lib/showings.js";

export default async function handler(req, res) {
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  try {
    const url = await getIcsUrl();
    res.status(200).json({ configured: !!url });
  } catch (e) {
    res.status(200).json({ configured: false, error: e.message });
  }
}
