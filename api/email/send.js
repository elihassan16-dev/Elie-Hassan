// ✉ Send an email FROM the signed-in teammate's own Goldstone mailbox, on the
// server (Elie 11/10/26: "Email statement" on his iPhone failed with MSAL
// "timed_out" — Safari / the app block the hidden Microsoft sign-in frame the
// browser uses to renew its token). Uses the same app-only Microsoft Graph
// permission (Mail.Send / Mail.ReadWrite) as the Claude connector's send_email,
// and only ever the caller's OWN mailbox (their Goldstone login email).
// POST { to, cc?, subject, html, attachments?: [{ name, type, base64 }] }
import { requireAppUser, isTeamUser } from "../../lib/showings.js";
import { graph, graphConfigured } from "../../lib/msGraph.js";

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const list = (v) => String(v || "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
const recip = (arr) => arr.map((address) => ({ emailAddress: { address } }));

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const user = await requireAppUser(req);
    if (!user) return res.status(401).json({ error: "Sign in first." });
    if (!(await isTeamUser(user.id))) return res.status(403).json({ error: "Team only." });
    if (!graphConfigured()) return res.status(503).json({ error: "Email isn't switched on on the server yet." });
    const me = String(user.email || "").trim();
    if (!EMAIL_RE.test(me)) return res.status(400).json({ error: "Your Goldstone login has no email address on file." });
    const b = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const to = list(b.to), cc = list(b.cc);
    if (!to.length) return res.status(400).json({ error: "Who should it go to?" });
    const bad = [...to, ...cc].find((x) => !EMAIL_RE.test(x));
    if (bad) return res.status(400).json({ error: `"${bad}" isn't an email address.` });
    if (to.length + cc.length > 20) return res.status(400).json({ error: "Too many recipients." });
    const atts = (Array.isArray(b.attachments) ? b.attachments : []).filter((a) => a && a.base64).slice(0, 5)
      .map((a) => ({ name: String(a.name || "attachment").slice(0, 120), type: String(a.type || "application/octet-stream"), base64: String(a.base64) }));
    const total = atts.reduce((t, a) => t + Math.floor(a.base64.length * 0.75), 0);
    if (total > 3 * 1024 * 1024) return res.status(413).json({ error: "The attachment is too big to send this way (over 3 MB)." });
    const mb = encodeURIComponent(me);
    const message = {
      subject: String(b.subject || "").slice(0, 250),
      body: { contentType: "HTML", content: String(b.html || "") },
      toRecipients: recip(to),
      ccRecipients: recip(cc),
      attachments: atts.map((a) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.name, contentType: a.type, contentBytes: a.base64 })),
    };
    await graph("POST", `/users/${mb}/sendMail`, { message, saveToSentItems: true });
    return res.status(200).json({ ok: true, from: me });
  } catch (e) {
    const msg = String((e && e.message) || "Couldn't send.");
    if (e && e.permission) return res.status(403).json({ error: `Microsoft hasn't allowed the app to send from your mailbox (${msg.slice(0, 160)}).` });
    if (e && e.status === 404) return res.status(404).json({ error: "Your Goldstone login email isn't a Goldstone Microsoft mailbox." });
    return res.status(500).json({ error: msg.slice(0, 300) });
  }
}
