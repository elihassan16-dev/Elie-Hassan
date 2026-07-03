// Daily task digest email. Two modes:
//   • Vercel Cron (no ?self) → emails every teammate their open tasks.
//   • ?self=1 with a signed-in user → emails just that user (used by the
//     "Email me my task digest now" button, and for testing).
// Only OPEN tasks (not Completed / N/A / deleted) are included, grouped by
// property, plus a section of tasks the user delegated out to someone else.
import { admin, requireAppUser } from "../../lib/quickbooks.js";

const OPEN = (t) => t && !t.deleted && (t.text || "").trim() && t.status !== "Completed" && t.status !== "N/A";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function buildDigest(name, props) {
  const mine = [];      // [{addr, status, tasks:[{text,status}]}] — tasks I do
  const delegated = []; // tasks I own but handed to someone else
  for (const p of props) {
    const addr = `${p.address || ""}${p.city ? `, ${p.city}` : ""}`.trim() || "Untitled property";
    const tasks = (p.data && Array.isArray(p.data.tasks)) ? p.data.tasks : [];
    const myOpen = [], delOpen = [];
    for (const t of tasks) {
      if (!OPEN(t)) continue;
      const isDoer = (t.assignee === name && !t.delegate) || t.delegate === name;
      const isDelegatedByMe = t.assignee === name && t.delegate && t.delegate !== name;
      if (isDoer) myOpen.push({ text: t.text, status: t.status || "Not Started" });
      else if (isDelegatedByMe) delOpen.push({ text: t.text, status: t.status || "Not Started", to: t.delegate });
    }
    if (myOpen.length) mine.push({ addr, status: p.status || "", tasks: myOpen });
    if (delOpen.length) delegated.push({ addr, status: p.status || "", tasks: delOpen });
  }
  return { mine, delegated, open: mine.reduce((n, g) => n + g.tasks.length, 0) + delegated.reduce((n, g) => n + g.tasks.length, 0) };
}

function digestHtml(name, d) {
  const chip = (s) => `<span style="font-size:11px;font-weight:700;color:#8a6d1f;background:#f7edd3;border-radius:20px;padding:2px 9px;">${esc(s)}</span>`;
  const group = (g, withTo) => `
    <div style="margin:0 0 16px;">
      <div style="font-size:14px;font-weight:700;color:#1b1a17;margin:0 0 6px;">${esc(g.addr)} ${g.status ? chip(g.status) : ""}</div>
      <table role="presentation" width="100%" style="border-collapse:collapse;">
        ${g.tasks.map((t) => `<tr>
          <td style="padding:7px 0;border-top:1px solid #ece9e2;font-size:14px;color:#2a2823;">• ${esc(t.text)}${withTo && t.to ? ` <span style="color:#6b6862;">→ ${esc(t.to.split(" ")[0])}</span>` : ""}</td>
          <td style="padding:7px 0;border-top:1px solid #ece9e2;font-size:12px;color:#6b6862;text-align:right;white-space:nowrap;">${esc(t.status)}</td>
        </tr>`).join("")}
      </table>
    </div>`;
  const section = (title, groups, withTo) => groups.length ? `
    <div style="margin:22px 0 0;">
      <div style="font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#b8953f;margin:0 0 10px;">${esc(title)}</div>
      ${groups.map((g) => group(g, withTo)).join("")}
    </div>` : "";
  return `<!doctype html><html><body style="margin:0;background:#f6f5f2;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:600px;margin:0 auto;padding:26px 20px;">
      <div style="font-size:20px;font-weight:800;color:#1b1a17;">Good morning, ${esc((name || "there").split(" ")[0])}.</div>
      <div style="font-size:14px;color:#6b6862;margin:4px 0 6px;">Here's what's still open — ${d.open} task${d.open === 1 ? "" : "s"}.</div>
      ${section("Your open tasks", d.mine, false)}
      ${section("Delegated by you (waiting on others)", d.delegated, true)}
      <div style="margin:26px 0 0;font-size:12px;color:#a49f95;border-top:1px solid #ece9e2;padding-top:14px;">Goldstone Properties · completed tasks aren't shown. Mark tasks done in the app and they'll drop off tomorrow.</div>
    </div></body></html>`;
}

async function sendEmail(to, subject, html) {
  const RESEND = process.env.RESEND_API_KEY, FROM = process.env.NOTIFY_FROM_EMAIL;
  if (!RESEND || !FROM) return "not-configured";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });
    return r.ok ? "sent" : `resend ${r.status}`;
  } catch { return "error"; }
}

export default async function handler(req, res) {
  const self = req.query && (req.query.self === "1" || req.query.self === "true");
  const db = admin();

  let onlyUser = null;
  if (self) {
    const u = await requireAppUser(req);
    if (!u) { res.status(401).json({ error: "Not signed in." }); return; }
    onlyUser = u;
  } else {
    // Cron path — if a CRON_SECRET is configured, require it (Vercel sends it).
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.authorization !== `Bearer ${secret}`) { res.status(401).json({ error: "Unauthorized" }); return; }
  }

  const { data: props } = await db.from("properties").select("id,address,city,status,data");
  const { data: users } = await db.from("users").select("id,email,name,notify_muted");
  const list = (users || []).filter((u) => u.email && u.name && !u.notify_muted &&
    (!onlyUser || u.id === onlyUser.id));

  let emailed = 0, openForSelf = 0, selfEmail = "skipped";
  for (const u of list) {
    const d = buildDigest(u.name, props || []);
    if (onlyUser) openForSelf = d.open;
    if (d.open === 0) continue; // nothing to nag about
    const status = await sendEmail(u.email, `Your Goldstone tasks — ${d.open} open`, digestHtml(u.name, d));
    if (status === "sent") emailed++;
    if (onlyUser) selfEmail = status;
  }

  res.status(200).json(onlyUser
    ? { emailed, open: openForSelf, email: selfEmail }
    : { emailed, recipients: list.length });
}
