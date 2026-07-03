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

// ── Wide, report-style PDF (landscape), styled like the app ──────────────────
const GOLD = "#B8953F", INK = "#1B1A17", SUB = "#6B6862", LINE = "#E4E0D7";
// Same status colors the website uses.
const PROP_SC = { "Under Contract": { color: "#9333EA", bg: "#F3E8FF" }, "Purchased": { color: "#2563EB", bg: "#DBEAFE" }, "Under Construction": { color: "#EA580C", bg: "#FFEDD5" }, "On Market": { color: "#16A34A", bg: "#DCFCE7" }, "In Closing": { color: "#CA8A04", bg: "#FEF9C3" }, "Sold": { color: "#65A30D", bg: "#ECFCCB" }, "Rental": { color: "#0891B2", bg: "#CFFAFE" }, "New Leads": { color: "#DB2777", bg: "#FCE7F3" } };
const TASK_SC = { "Not Started": { bg: "#F2F2F7", color: "#8A8A8E" }, "In Progress": { bg: "#FFF4E5", color: "#FF9500" }, "Completed": { bg: "#EDFBF1", color: "#34C759" }, "N/A": { bg: "#F2F2F7", color: "#AEAEB2" } };

function buildDigestPdf(name, d, dateStr) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "letter", layout: "landscape", margin: 42 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const L = doc.page.margins.left, R = doc.page.width - doc.page.margins.right, W = R - L;
    const bottom = doc.page.height - doc.page.margins.bottom;
    const statusColX = R - 128;                 // status pills sit in this right-hand lane
    const textW = statusColX - (L + 16) - 8;    // task text width (leaves room for the pill)
    const ensure = (h) => { if (doc.y + h > bottom) doc.addPage(); };

    // A rounded, colored status pill; returns its width. Right-aligns to endX.
    const pill = (label, sc, endX, y, fs = 8) => {
      doc.font("Helvetica-Bold").fontSize(fs);
      const tw = doc.widthOfString(label), padX = 7, h = fs + 8, w = tw + padX * 2, x = endX - w;
      doc.roundedRect(x, y, w, h, h / 2).fill(sc.bg);
      doc.fillColor(sc.color).text(label, x + padX, y + (h - fs) / 2 - 0.5, { lineBreak: false });
      return w;
    };

    // Header band
    doc.rect(0, 0, doc.page.width, 76).fill(GOLD);
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(21).text("Goldstone Properties", L, 20);
    doc.font("Helvetica").fontSize(11).fillColor("#F7EDD3").text(dateStr, L, 24, { width: W, align: "right" });
    doc.fillColor("#FBF6EC").fontSize(12).text(`Open tasks for ${name} — ${d.open} total`, L, 48);
    doc.y = 96;

    const sectionTitle = (t) => {
      ensure(36); doc.moveDown(0.5);
      doc.font("Helvetica-Bold").fontSize(11.5).fillColor(GOLD).text(t.toUpperCase(), L, doc.y, { characterSpacing: 1 });
      doc.moveTo(L, doc.y + 3).lineTo(R, doc.y + 3).lineWidth(1.2).strokeColor(GOLD).stroke();
      doc.moveDown(0.7);
    };
    const propHeader = (g) => {
      ensure(30);
      const y = doc.y;
      doc.roundedRect(L, y, W, 25, 6).fill("#F6F3EC");                     // subtle header band
      doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(g.addr, L + 12, y + 7, { width: textW, lineBreak: false });
      if (g.status) pill(g.status, PROP_SC[g.status] || { bg: "#F1F5F9", color: "#64748B" }, R - 12, y + 5, 8.5);
      doc.y = y + 25 + 7;
    };
    const taskRow = (t, withTo) => {
      doc.font("Helvetica").fontSize(10.5);
      const th = Math.max(doc.heightOfString(t.text, { width: textW }), 13);
      const showTo = withTo && t.to;
      const subH = showTo ? 14 : 0;
      ensure(th + subH + 12);
      const y = doc.y;
      doc.circle(L + 8, y + 6, 1.6).fill(GOLD);                            // bullet
      doc.font("Helvetica").fontSize(10.5).fillColor("#2A2823").text(t.text, L + 16, y, { width: textW });
      if (showTo) doc.font("Helvetica-Oblique").fontSize(9).fillColor(GOLD)
        .text(`Delegated to ${t.to}`, L + 16, y + th + 2, { width: textW, lineBreak: false });
      pill(t.status, TASK_SC[t.status] || TASK_SC["Not Started"], R - 12, y - 1, 8);
      doc.y = y + th + subH + 6;
      doc.moveTo(L + 16, doc.y).lineTo(R - 12, doc.y).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.moveDown(0.35);
    };

    if (d.open === 0) {
      doc.font("Helvetica").fontSize(13).fillColor(SUB).text("No open tasks. You're all caught up.", L, doc.y + 10);
    } else {
      if (d.mine.length) { sectionTitle("Your open tasks"); d.mine.forEach((g) => { propHeader(g); g.tasks.forEach((t) => taskRow(t, false)); doc.moveDown(0.6); }); }
      if (d.delegated.length) { sectionTitle("Delegated by you (waiting on others)"); d.delegated.forEach((g) => { propHeader(g); g.tasks.forEach((t) => taskRow(t, true)); doc.moveDown(0.6); }); }
    }

    ensure(16);
    doc.font("Helvetica").fontSize(8.5).fillColor("#A49F95")
      .text("Completed tasks are not shown. Mark tasks done in the app and they drop off tomorrow.", L, doc.y + 6, { width: W });
    doc.end();
  });
}

function digestHtml(name, d) {
  const first = esc((name || "there").split(" ")[0]);
  return `<!doctype html><html><body style="margin:0;background:#f6f5f2;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:30px 22px;">
      <div style="background:#ffffff;border:1px solid #e4e0d7;border-radius:14px;overflow:hidden;">
        <div style="background:#B8953F;height:8px;"></div>
        <div style="padding:26px 24px 28px;">
          <div style="font-size:20px;font-weight:800;color:#1b1a17;margin:0 0 12px;">Good morning, ${first}! ☀️</div>
          <div style="font-size:15px;color:#2a2823;line-height:1.6;">Please see your <b>open tasks</b> attached.</div>
          <div style="font-size:15px;color:#2a2823;line-height:1.6;margin-top:10px;">Have a great day — and don't forget to mark items as done. ✅</div>
          <div style="font-size:13px;color:#6b6862;margin-top:18px;">${d.open} open task${d.open === 1 ? "" : "s"} · full list in the attached PDF.</div>
        </div>
      </div>
      <div style="text-align:center;font-size:12px;color:#a49f95;margin-top:16px;">Goldstone Properties</div>
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
