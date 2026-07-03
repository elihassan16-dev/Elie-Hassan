import { requireAppUser, isAdminUser } from "../../lib/showings.js";
import { updateUserEmail } from "../../lib/team.js";

// Change a login + notification email. You can always change your own; admins can
// change anyone's (pass userId).
export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed." }); return; }
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const email = (body.email || "").trim().toLowerCase();
    const targetId = body.userId || user.id;
    if (targetId !== user.id && !(await isAdminUser(user.id))) {
      res.status(403).json({ error: "Only an admin can change someone else's email." }); return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.status(400).json({ error: "Enter a valid email address." }); return; }
    const result = await updateUserEmail({ userId: targetId, email });
    res.status(200).json({ ok: true, ...result });
  } catch (e) {
    const msg = /already been registered|already exists|duplicate|registered/i.test(e.message || "")
      ? "That email is already used by another account."
      : e.message;
    res.status(400).json({ error: msg });
  }
}
