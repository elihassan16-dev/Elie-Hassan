// The app reports its real unread count (team + contractors) so the next push
// while it's closed shows the right number on the icon. See lib/badge.js.
import { admin, requireAppUser } from "../../lib/quickbooks.js";
import { setBadge } from "../../lib/badge.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const n = await setBadge(admin(), user.id, (body && body.count) || 0);
  res.status(200).json({ ok: true, n });
}
