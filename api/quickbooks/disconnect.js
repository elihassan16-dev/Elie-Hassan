import { disconnect, requireTeamUser } from "../../lib/quickbooks.js";

export default async function handler(req, res) {
  const user = await requireTeamUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  try {
    await disconnect();
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[quickbooks] disconnect failed:", e.message);
    res.status(500).json({ error: e.message });
  }
}
