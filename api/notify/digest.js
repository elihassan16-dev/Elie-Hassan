// Daily task digest email — with a wide, report-style PDF attachment.
// Modes:
//   • Vercel Cron (no query)  → emails every teammate their open tasks.
//   • ?self=1  (signed in)    → emails just the caller (preview / test).
//   • ?all=1   (admin)        → emails every teammate now (manual trigger).
// Only OPEN tasks (not Completed / N/A / deleted), grouped by property, plus a
// "Delegated by you" section for tasks the user handed to someone else.
import PDFDocument from "pdfkit";
import { admin, requireAppUser } from "../../lib/quickbooks.js";

const OPEN = (t) => t && !t.deleted && (t.text || "").trim() && t.status !== "Completed" && t.status !== "N/A";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function buildDigest(name, props) {
  const mine = [], delegated = [];
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

// ── Wide, report-style PDF (landscape) ────────────────────────────────────────
const GOLD = "#B8953F", INK = "#1B1A17", SUB = "#6B6862", LINE = "#E4E0D7", CARD = "#FAF8F3";
function buildDigestPdf(name, d, dateStr) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "letter", layout: "landscape", margin: 42 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const L = doc.page.margins.left, R = doc.page.width - doc.page.margins.right, W = R - L;
    const bottom = doc.page.height - doc.page.margins.bottom;
    const statusX = R - 150, textW = statusX - L - 12;

    const ensure = (h) => { if (doc.y + h > bottom) doc.addPage(); };

    // Header band
    doc.rect(0, 0, doc.page.width, 74).fill(GOLD);
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(20).text("Goldstone Properties", L, 22);
    doc.font("Helvetica").fontSize(11).fillColor("#fff").text(dateStr, L, 22, { width: W, align: "right" });
    doc.fillColor("rgba(255,255,255,0.9)").fontSize(12).text(`Open tasks for ${name} — ${d.open} total`, L, 46);
    doc.y = 92;

    const sectionTitle = (t) => {
      ensure(34);
      doc.moveDown(0.4);
      doc.font("Helvetica-Bold").fontSize(12).fillColor(GOLD).text(t.toUpperCase(), L, doc.y, { characterSpacing: 1 });
      doc.moveTo(L, doc.y + 2).lineTo(R, doc.y + 2).lineWidth(1).strokeColor(GOLD).stroke();
      doc.moveDown(0.5);
    };
    const propHeader = (g) => {
      ensure(24);
      const y = doc.y;
      doc.font("Helvetica-Bold").fontSize(12.5).fillColor(INK).text(g.addr, L, y, { width: textW });
      if (g.status) doc.font("Helvetica").fontSize(9.5).fillColor(SUB).text(g.status, statusX, y + 1, { width: 150, align: "right" });
      doc.moveDown(0.2);
    };
    const taskRow = (t, withTo) => {
      ensure(18);
      const y = doc.y;
      doc.font("Helvetica").fontSize(10.5).fillColor("#2A2823")
        .text(`•  ${t.text}${withTo && t.to ? `   →  ${String(t.to).split(" ")[0]}` : ""}`, L + 6, y, { width: textW });
      const yEnd = doc.y;
      doc.font("Helvetica").fontSize(9.5).fillColor(SUB).text(t.status, statusX, y, { width: 150, align: "right" });
      doc.y = yEnd;
      doc.moveDown(0.15);
      doc.moveTo(L + 6, doc.y).lineTo(R, doc.y).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.moveDown(0.2);
    };

    if (d.open === 0) {
      doc.font("Helvetica").fontSize(13).fillColor(SUB).text("No open tasks. You're all caught up.", L, doc.y + 10);
    } else {
      if (d.mine.length) { sectionTitle("Your open tasks"); d.mine.forEach((g) => { propHeader(g); g.tasks.forEach((t) => taskRow(t, false)); doc.moveDown(0.3); }); }
      if (d.delegated.length) { sectionTitle("Delegated by you (waiting on others)"); d.delegated.forEach((g) => { propHeader(g); g.tasks.forEach((t) => taskRow(t, true)); doc.moveDown(0.3); }); }
    }

    doc.font("Helvetica").fontSize(8.5).fillColor("#A49F95")
      .text("Completed tasks are not shown. Mark tasks done in the app and they drop off tomorrow.", L, bottom - 4, { width: W });
    doc.end();
  });
}

function digestHtml(name, d) {
  const chip = (s) => `<span style="font-size:11px;font-weight:700;color:#8a6d1f;background:#f7edd3;border-radius:20px;padding:2px 9px;">${esc(s)}</span>`;
  const group = (g, withTo) => `
    <div style="margin:0 0 14px;">
      <div style="font-size:14px;font-weight:700;color:#1b1a17;margin:0 0 4px;">${esc(g.addr)} ${g.status ? chip(g.status) : ""}</div>
      <table role="presentation" width="100%" style="border-collapse:collapse;">
        ${g.tasks.map((t) => `<tr>
          <td style="padding:6px 0;border-top:1px solid #ece9e2;font-size:14px;color:#2a2823;">• ${esc(t.text)}${withTo && t.to ? ` <span style="color:#6b6862;">→ ${esc(String(t.to).split(" ")[0])}</span>` : ""}</td>
          <td style="padding:6px 0;border-top:1px solid #ece9e2;font-size:12px;color:#6b6862;text-align:right;white-space:nowrap;">${esc(t.status)}</td>
        </tr>`).join("")}
      </table>
    </div>`;
  const section = (title, groups, withTo) => groups.length ? `
    <div style="margin:20px 0 0;"><div style="font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#b8953f;margin:0 0 8px;">${esc(title)}</div>${groups.map((g) => group(g, withTo)).join("")}</div>` : "";
  return `<!doctype html><html><body style="margin:0;background:#f6f5f2;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:600px;margin:0 auto;padding:24px 20px;">
      <div style="font-size:20px;font-weight:800;color:#1b1a17;">Good morning, ${esc((name || "there").split(" ")[0])}.</div>
      <div style="font-size:14px;color:#6b6862;margin:4px 0 2px;">Here's what's still open — ${d.open} task${d.open === 1 ? "" : "s"}. The attached PDF has the full report.</div>
      ${section("Your open tasks", d.mine, false)}
      ${section("Delegated by you (waiting on others)", d.delegated, true)}
      <div style="margin:24px 0 0;font-size:12px;color:#a49f95;border-top:1px solid #ece9e2;padding-top:12px;">Goldstone Properties · completed tasks aren't shown.</div>
    </div></body></html>`;
}

async function sendEmail(to, subject, html, pdfBuf) {
  const RESEND = process.env.RESEND_API_KEY, FROM = process.env.NOTIFY_FROM_EMAIL;
  if (!RESEND || !FROM) return "not-configured";
  const body = { from: FROM, to, subject, html };
  if (pdfBuf) body.attachments = [{ filename: "goldstone-tasks.pdf", content: pdfBuf.toString("base64") }];
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) return "sent";
    const j = await r.json().catch(() => null);
    return `resend ${r.status}: ${(j && (j.message || j.error || j.name)) || ""}`.trim();
  } catch { return "error"; }
}

export default async function handler(req, res) {
  const q = req.query || {};
  const self = q.self === "1" || q.self === "true";
  const all = q.all === "1" || q.all === "true";
  const db = admin();

  let onlyUser = null;
  if (self || all) {
    const u = await requireAppUser(req);
    if (!u) { res.status(401).json({ error: "Not signed in." }); return; }
    if (all) {
      const { data: me } = await db.from("users").select("role").eq("id", u.id).single();
      if (!me || me.role !== "admin") { res.status(403).json({ error: "Admins only." }); return; }
      // onlyUser stays null → everyone
    } else {
      onlyUser = u;
    }
  } else {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.authorization !== `Bearer ${secret}`) { res.status(401).json({ error: "Unauthorized" }); return; }
  }

  const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const { data: props } = await db.from("properties").select("id,address,city,status,data");
  const { data: users } = await db.from("users").select("id,email,name,notify_muted");
  const list = (users || []).filter((u) => u.email && u.name && !u.notify_muted && (!onlyUser || u.id === onlyUser.id));

  let emailed = 0, openForSelf = 0, selfEmail = "skipped";
  for (const u of list) {
    const d = buildDigest(u.name, props || []);
    if (onlyUser) openForSelf = d.open;
    if (d.open === 0) continue;
    let pdf = null;
    try { pdf = await buildDigestPdf(u.name, d, dateStr); } catch (e) { console.error("[digest] pdf failed:", e.message); }
    const status = await sendEmail(u.email, `Your Goldstone tasks — ${d.open} open`, digestHtml(u.name, d), pdf);
    if (status === "sent") emailed++;
    if (onlyUser) selfEmail = status;
  }

  res.status(200).json(onlyUser ? { emailed, open: openForSelf, email: selfEmail } : { emailed, recipients: list.length });
}
