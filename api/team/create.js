import { requireAppUser, isAdminUser } from "../../lib/showings.js";
import { createTeamMember } from "../../lib/team.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed." }); return; }
  try {
    const user = await requireAppUser(req);
    if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
    // isAdminUser needs the service-role key — inside the try so a missing env
    // var (e.g. not enabled for Vercel Preview) returns a readable error, not a 500.
    if (!(await isAdminUser(user.id))) { res.status(403).json({ error: "Only an admin can add teammates." }); return; }
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const name = (body.name || "").trim();
    const email = (body.email || "").trim().toLowerCase();
    const password = (body.password || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.status(400).json({ error: "Enter a valid email address." }); return; }
    if (password.length < 8) { res.status(400).json({ error: "Password must be at least 8 characters." }); return; }
    const member = await createTeamMember({ name, email, password, role: body.role || "member", contractorOrgId: body.contractorOrgId || null });
    res.status(200).json({ ok: true, member });
  } catch (e) {
    const msg = /already been registered|already exists|duplicate|registered/i.test(e.message || "")
      ? "That email already has an account."
      : e.message;
    res.status(400).json({ error: msg });
  }
}
