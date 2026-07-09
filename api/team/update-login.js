// Admin-only login management (used by the Contractors page): change a login's
// email and/or password, or remove the login entirely. Email changes go through
// updateUserEmail so the actual sign-in email changes too — not just the profile.
import { requireAppUser, isAdminUser } from "../../lib/showings.js";
import { updateUserEmail, updateUserPassword, removeUser } from "../../lib/team.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed." }); return; }
  try {
    const user = await requireAppUser(req);
    if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
    if (!(await isAdminUser(user.id))) { res.status(403).json({ error: "Only an admin can manage logins." }); return; }
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const userId = body.userId;
    if (!userId) { res.status(400).json({ error: "Missing userId." }); return; }
    if (userId === user.id && body.remove) { res.status(400).json({ error: "You can't remove your own login." }); return; }

    if (body.remove) {
      await removeUser({ userId });
      res.status(200).json({ ok: true, removed: true });
      return;
    }
    const email = (body.email || "").trim().toLowerCase();
    const password = (body.password || "").trim();
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.status(400).json({ error: "Enter a valid email address." }); return; }
      await updateUserEmail({ userId, email });
    }
    if (password) {
      if (password.length < 8) { res.status(400).json({ error: "Password must be at least 8 characters." }); return; }
      await updateUserPassword({ userId, password });
    }
    if (!email && !password) { res.status(400).json({ error: "Nothing to change." }); return; }
    res.status(200).json({ ok: true });
  } catch (e) {
    const msg = /already been registered|already exists|duplicate|registered/i.test(e.message || "")
      ? "That email is already used by another account."
      : e.message;
    res.status(400).json({ error: msg });
  }
}
