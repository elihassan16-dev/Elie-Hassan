// 🤖 Claude connector — round 3 (Elie 10/14/26): scope-of-work PDFs,
// contractor jobs (waiting on me, change orders, job messages), deal numbers +
// private-lender balances (ADMIN ONLY), leads, and batch follow-up texts.
// Same rules as lib/mcpTools.js: everything runs as the signed-in teammate,
// anything that reaches someone outside the team needs confirmed=true.
import PDFDocument from "pdfkit";
import { notifyFanout } from "./notify.js";
import { sameFirst } from "./jivetel.js";
import { graphConfigured, uploadToFolder } from "./msGraph.js";
import { finProfit, drawRate, drawBalance, drawInterest, drawsForProperty, funderStats, n as num } from "./dealMath.js";
import {
  sendSmsAs, fail, norm, addrOf, first, nowIso, newId, fmtDate, loadProps, findProp, saveProp,
  subFolder, isDone, STORAGE_PUBLIC,
} from "./mcpTools.js";

const $ = (v) => `${v < 0 ? "-" : ""}$${Math.round(Math.abs(Number(v) || 0)).toLocaleString("en-US")}`;
const pctRate = (r) => `${Math.round(r * 10000) / 100}%`;
const adminOnly = (me) => { if (me.role !== "admin") fail("Only Elie (admin) can see money numbers through Claude."); };

// ── Contractor data ──────────────────────────────────────────────────────────
const rowsOf = async (db, table) => {
  const { data, error } = await db.from(table).select("id,data");
  if (error) fail(`Couldn't load ${table.replace("contractor_", "contractor ")}: ${error.message}`);
  return (data || []).map((r) => r.data).filter(Boolean);
};
const loadJobs = async (db) => (await rowsOf(db, "contractor_jobs")).filter((j) => j.status !== "removed");
const orgNamer = (orgs) => (id) => ((orgs || []).find((o) => String(o.id) === String(id)) || {}).name || "Contractor";
const jobTotal = (j) => num(j.price) + (j.changeOrders || []).reduce((s, c) => s + num(c.amount), 0);
const jobPaid = (j) => (j.payments || []).reduce((s, p) => s + num(p.amount), 0);
const ctrClosed = (s) => s === "Completed" || s === "N/A";
const jobLabel = (j, on) => `${on(j.orgId)} — ${j.propertyAddress || "no address"}${j.title ? ` (${j.title})` : ""} [job ${j.id}${j.status && j.status !== "active" ? `, ${j.status}` : ""}]`;
async function saveJob(db, job) {
  const { error } = await db.from("contractor_jobs").upsert({ id: String(job.id), org_id: String(job.orgId), data: job, updated_at: nowIso() }, { onConflict: "id" });
  if (error) fail(`Couldn't save the job: ${error.message}`);
}
async function ctrInsert(db, table, obj) {
  const { error } = await db.from(table).upsert({ id: String(obj.id), org_id: String(obj.orgId), data: obj, updated_at: nowIso() }, { onConflict: "id" });
  if (error) fail(`Couldn't save: ${error.message}`);
}
// Narrow jobs by property / contractor / job words-or-id.
async function matchJobs(db, a, jobs, orgs) {
  const on = orgNamer(orgs);
  let list = jobs;
  if (a.job) {
    const id = String(a.job).replace(/^#|^job\s*/i, "").trim();
    const byId = list.filter((j) => String(j.id) === id);
    list = byId.length ? byId : list.filter((j) => norm(`${j.title || ""} ${j.scope || ""}`.slice(0, 400)).includes(norm(a.job)));
  }
  if (a.property) {
    let p = null;
    try { p = findProp(await loadProps(db), a.property).p; } catch { /* sold/archived — fall back to the job's own address */ }
    list = list.filter((j) => (p && String(j.propertyId) === String(p.id)) || norm(j.propertyAddress).includes(norm(p ? p.address : a.property)));
  }
  if (a.contractor) list = list.filter((j) => norm(on(j.orgId)).includes(norm(a.contractor)));
  return list;
}
async function oneJob(db, a) {
  if (!a.job && !a.property && !a.contractor) fail("Which job? Give the property, the contractor, or both.");
  const [jobs, orgs] = await Promise.all([loadJobs(db), rowsOf(db, "contractor_orgs")]);
  const on = orgNamer(orgs);
  let list = await matchJobs(db, a, jobs, orgs);
  if (list.length > 1) { const live = list.filter((j) => j.status === "active" || j.status === "bid"); if (live.length) list = live; }
  if (!list.length) fail("No contractor job matches that.");
  if (list.length > 1) fail(`That matches ${list.length} jobs: ${list.slice(0, 8).map((j) => jobLabel(j, on)).join(" | ")}. Say which (contractor name or job id).`);
  return { job: list[0], on };
}

// ── Scope-of-work PDF (pdfkit, same look as the app's jsPDF one) ─────────────
// Standard PDF fonts only speak Latin-1 (WinAnsi): keep dashes/quotes/bullets,
// drop anything else (emoji etc.) so nothing prints as garbage.
const WIN = new Set([..."€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ"]);
const pdfSafe = (s) => [...String(s || "").replace(/\t/g, "    ").replace(/[✓✔]/g, "-").replace(/[→➔]/g, "->")].filter((c) => c.charCodeAt(0) <= 255 || WIN.has(c)).join("");
function scopePdf({ address, title, by, text }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "letter", margin: 56, bufferPages: true, info: { Title: `Scope of Work — ${address}`, Author: "Goldstone Properties" } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    const L = 56, W = doc.page.width - 112, GOLD = "#B8912E";
    doc.font("Times-Bold").fontSize(19).fillColor(GOLD).text("Goldstone Properties", L, 56);
    doc.moveDown(0.15).fontSize(13).fillColor("#3C3C3C").text("Scope of Work");
    doc.moveDown(0.3).font("Times-Roman").fontSize(11).fillColor("#5A5A5A").text(pdfSafe(`${address}${title ? ` — ${title}` : ""}`), { width: W });
    doc.text(pdfSafe(`Prepared ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" })} by ${by}`));
    doc.moveDown(0.5); const y = doc.y; doc.moveTo(L, y).lineTo(L + W, y).lineWidth(1.4).strokeColor(GOLD).stroke(); doc.moveDown(0.8);
    for (const raw of pdfSafe(text).split(/\r?\n/)) {
      const line = raw.replace(/^\s*(#+|\*\*)\s*|\*\*$/g, "").trimEnd();
      if (!line.trim()) { doc.moveDown(0.45); continue; }
      const isHead = /[A-Z]/.test(line) && !/[a-z]/.test(line) && line.trim().length <= 70 && !/^\s*\d+[.)]/.test(line);
      if (isHead) {
        if (doc.y > doc.page.height - 120) doc.addPage();
        doc.moveDown(0.35).font("Times-Bold").fontSize(12).fillColor("#8A6D1F").text(line.trim(), L, doc.y, { width: W }); doc.moveDown(0.2);
        continue;
      }
      const m = line.match(/^\s*(\d+[.)]|[-•*])\s+(.*)$/);
      doc.font("Times-Roman").fontSize(11).fillColor("#1C1C1E");
      if (m) {
        const y0 = doc.y, mark = m[1] === "*" || m[1] === "-" ? "•" : m[1];
        doc.text(mark, L + 4, y0, { width: 22, lineBreak: false });
        doc.text(m[2], L + 28, y0, { width: W - 28, lineGap: 1.5 });
      } else doc.text(line.trim(), L, doc.y, { width: W, lineGap: 1.5 });
      doc.moveDown(0.15);
    }
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // footer sits below the text area — don't let it start a new page
      doc.font("Times-Italic").fontSize(9).fillColor("#8E8E93").text(`Goldstone Properties · ${pdfSafe(address)} · Page ${i + 1} of ${range.count}`, L, doc.page.height - 40, { width: W, align: "center", lineBreak: false });
    }
    doc.end();
  });
}
const fileName = (s) => String(s || "").replace(/[\\/:*?"<>|#%]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

// ── Tool definitions ─────────────────────────────────────────────────────────
const S = (props, required = []) => ({ type: "object", properties: props, required, additionalProperties: false });
const str = (d) => ({ type: "string", description: d });
const JOB = { property: str("Property address (part is fine)."), contractor: str("Contractor company name (part is fine)."), job: str("Job id or words from the job title (optional).") };
const SOW_RULES = "Write the scope like the team's own scopes: plain text (no markdown), UPPERCASE headings by trade/area (DEMOLITION, FRAMING, PLUMBING, ELECTRICAL, HVAC, DRYWALL & PAINT, FLOORING, KITCHEN, BATHROOMS, EXTERIOR, SITE & CLEANUP — only those that apply), numbered specific line items under each (materials grade, quantities, code/permits), NO prices, mark guesses \"(assumed — confirm)\", and end with a short GENERAL CONDITIONS section (licensed & insured, debris removal, workmanship warranty, change-order process).";

export const MORE_TOOLS = [
  { name: "create_scope_of_work", title: "Make a scope-of-work PDF", description: `Turn a scope of work into a branded Goldstone PDF, file it on the property (team chat + the property's OneDrive "Scope of Work" folder when linked) and return the link. ${SOW_RULES} Show the user the scope first. Optionally put it on a contractor's job (contractor/job) — that updates the job and messages the contractor, so it needs the user's yes and confirmed=true. To email it, use send_email with attachments [{url, name}].`,
    inputSchema: S({ property: str("Property address."), scope: str("The full scope text."), title: str('Short title, e.g. "Kitchen + 2 baths" (optional).'), contractor: str("Put it on this contractor's job on the property (optional)."), job: str("Job id if the contractor has several (optional)."), confirmed: { type: "boolean", description: "Required (true) only when putting it on a contractor's job, after the user's OK." } }, ["property", "scope"]) },
  { name: "contractor_waiting", title: "Contractor items waiting on me", description: "What contractors are waiting on: change-order requests to approve or deny, bids that came in, requests the contractors asked of the team (the ones asked of me first), and unread contractor messages.",
    inputSchema: S({}), annotations: { readOnlyHint: true } },
  { name: "contractor_jobs", title: "Contractor jobs", description: "List contractor jobs (contractor, property, title, status, open requests; contract total / paid / left for the admin). Filter by property and/or contractor.",
    inputSchema: S({ property: JOB.property, contractor: JOB.contractor, include_done: { type: "boolean", description: "Include complete jobs." } }), annotations: { readOnlyHint: true } },
  { name: "decide_change_order", title: "Approve or deny a change order", description: "Approve or deny a contractor's pending change-order request (admin only). Approving adds it to the contract total. The contractor is notified and it's posted in the job chat. Show the user the request (label, amount, job) and get a yes first; then confirmed=true.",
    inputSchema: S({ ...JOB, request: str("Words from the change-order request (optional if the job has only one pending)."), approve: { type: "boolean", description: "true = approve, false = deny." }, confirmed: { type: "boolean" } }, ["approve", "confirmed"]), annotations: { destructiveHint: false, openWorldHint: true } },
  { name: "contractor_messages", title: "Read a contractor job chat", description: "The latest messages in a contractor job's chat (team ↔ contractor).",
    inputSchema: S({ ...JOB, limit: { type: "integer", minimum: 1, maximum: 50, description: "How many (default 15)." } }), annotations: { readOnlyHint: true } },
  { name: "message_contractor", title: "Message a contractor", description: "Post a message in a contractor job's chat as the signed-in teammate; the contractor gets a notification. Show the user the exact message and job and get a yes first; then confirmed=true.",
    inputSchema: S({ ...JOB, text: str("The message."), confirmed: { type: "boolean" } }, ["text", "confirmed"]), annotations: { destructiveHint: false, openWorldHint: true } },
  { name: "deal_numbers", title: "Deal numbers", description: "ADMIN ONLY. A property's deal numbers exactly as the Financial Overview shows them: purchase price, ARV/sale price, rehab budget vs actual, buying/selling/holding costs, financing cost, projected net profit (and actual if sold), cash needed, plus private-lender money on it.",
    inputSchema: S({ property: str("Property address.") }, ["property"]), annotations: { readOnlyHint: true } },
  { name: "lender_balances", title: "Private lender balances", description: "ADMIN ONLY. What Goldstone owes each private lender right now: open loans (property, amount, rate, date funded, principal left, interest so far, total owed), totals per lender, capital and available. Filter by lender and/or property.",
    inputSchema: S({ lender: str("Lender name (optional)."), property: str("Only loans on this property (optional).") }), annotations: { readOnlyHint: true } },
  { name: "list_leads", title: "Leads", description: 'Seller leads from the New Leads page (address, seller, phone, asking price, source, date added) — or kind="buyers" for BoldTrail buyer leads tagged to our listings. Default: added in the last 7 days.',
    inputSchema: S({ days: { type: "integer", minimum: 1, maximum: 365, description: "Added in the last N days (default 7)." }, query: str("Address / name / town to look for (optional)."), kind: { type: "string", enum: ["sellers", "buyers"] } }), annotations: { readOnlyHint: true } },
  { name: "send_texts", title: "Send several texts", description: "Send several SMS at once (e.g. showing follow-ups to every agent not texted yet), each from the signed-in teammate's own line. ALWAYS show the user the full list (recipient + exact message for each) and get ONE explicit yes for the whole list; then call with confirmed=true. Max 25.",
    inputSchema: S({ texts: { type: "array", maxItems: 25, items: { type: "object", properties: { to: { type: "string", description: "Phone number or contact name." }, message: { type: "string" }, property: { type: "string" } }, required: ["to", "message"], additionalProperties: false } }, confirmed: { type: "boolean" } }, ["texts", "confirmed"]), annotations: { destructiveHint: false, openWorldHint: true } },
];

export async function runMore(db, name, a, me) {
  switch (name) {
    case "create_scope_of_work": {
      const text = String(a.scope || "").trim();
      if (text.length < 20) fail("The scope is empty — write it first.");
      const toJob = !!(a.contractor || a.job);
      if (toJob && a.confirmed !== true) fail("Not saved. Putting it on the contractor's job messages them — show the user the scope and the job, get a yes, then call again with confirmed=true.");
      const { rowId, p } = findProp(await loadProps(db), a.property);
      const address = addrOf(p);
      const jm = toJob ? await oneJob(db, { property: String(p.address || a.property), contractor: a.contractor, job: a.job }) : null;
      const job = jm && jm.job;
      const buf = await scopePdf({ address, title: a.title, by: me.name, text });
      const nice = `Scope of Work - ${fileName(p.address) || "property"}${a.title ? ` - ${fileName(a.title)}` : ""}.pdf`;
      const path = `sow/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${nice.replace(/[^A-Za-z0-9.-]+/g, "_")}`;
      const up = await db.storage.from("attachments").upload(path, buf, { contentType: "application/pdf", upsert: false });
      if (up.error) fail(`Couldn't save the PDF: ${up.error.message}`);
      const url = db.storage.from("attachments").getPublicUrl(path).data.publicUrl;
      if (!String(url).startsWith(STORAGE_PUBLIC)) console.warn("[mcp] storage url outside STORAGE_PUBLIC", url);
      const attachment = { url, name: nice, mime: "application/pdf", kind: "file" };
      await saveProp(db, rowId, (x) => ({ ...x, messages: [...(x.messages || []), { id: newId(), author: me.name, text: `📄 Scope of work${a.title ? `: ${a.title}` : ""}${job ? ` — sent to ${jm.on(job.orgId)}` : ""}`, at: nowIso(), readBy: [me.name], attachment, via: "claude" }] }));
      const notes = [];
      if (p.filesFolder && p.filesFolder.driveId && p.filesFolder.id && graphConfigured()) {
        try {
          const f = { p, driveId: p.filesFolder.driveId, id: p.filesFolder.id };
          const fid = await subFolder(f, "Scope of Work", true);
          const it = await uploadToFolder(f.driveId, fid, nice, buf);
          notes.push(`Saved to OneDrive: ${address} / Scope of Work / ${it.name || nice}.`);
        } catch (e) { notes.push(`Not saved to OneDrive yet (${e.permission || e.status === 403 ? "Microsoft permission still pending" : e.message}).`); }
      }
      if (job) {
        const at = nowIso();
        await saveJob(db, { ...job, scope: text, sowItems: null, sowPdfUrl: url, sowPdfName: nice, scopeEditedAt: at, scopeEditedBy: me.name });
        await ctrInsert(db, "contractor_docs", { id: newId(), jobId: job.id, orgId: job.orgId, name: nice, url, mime: "application/pdf", by: me.name, at });
        await ctrInsert(db, "contractor_messages", { id: newId(), jobId: job.id, orgId: job.orgId, author: me.name, side: "team", text: `🧾 Updated scope of work${a.title ? ` — ${a.title}` : ""} attached. Please review it.`, at, readBy: [me.name], attachment, via: "claude" });
        try { await notifyFanout(db, me.id, { toOrg: job.orgId, title: `Goldstone — ${job.propertyAddress || address}`, body: "Updated scope of work — please review it.", url: `/?goto=job:${job.id}` }); } catch { /* best effort */ }
        notes.push(`Put on ${jobLabel(job, jm.on)} and sent to the contractor.`);
      }
      return [`Scope of work PDF for ${address} is ready: ${url}`, `Filed in the ${address} team chat.`, ...notes, `To email it: send_email with attachments [{"url":"${url}","name":"${nice}"}].`].join("\n");
    }
    case "contractor_waiting": {
      const [jobs, orgs, tasks, msgs] = await Promise.all([loadJobs(db), rowsOf(db, "contractor_orgs"), rowsOf(db, "contractor_tasks"), rowsOf(db, "contractor_messages")]);
      const on = orgNamer(orgs), byId = new Map(jobs.map((j) => [String(j.id), j]));
      const co = jobs.flatMap((j) => (j.coRequests || []).filter((r) => r.status === "pending").map((r) => ({ r, j })));
      const bids = jobs.filter((j) => j.status === "bid" && j.bidAmount);
      const reqs = tasks.filter((t) => t.direction === "to_team" && !ctrClosed(t.status) && byId.has(String(t.jobId)));
      const mine = reqs.filter((t) => (t.askedOf || []).some((x) => sameFirst(x, me.name)));
      const rest = reqs.filter((t) => !mine.includes(t));
      const since = Date.now() - 30 * 86400000;
      const unread = new Map();
      for (const m of msgs) {
        if (m.side !== "contractor" || !byId.has(String(m.jobId)) || Date.parse(m.at) < since || (m.readBy || []).some((x) => sameFirst(x, me.name))) continue;
        const u = unread.get(String(m.jobId)) || { n: 0, last: null }; u.n++; if (!u.last || String(m.at) > String(u.last.at)) u.last = m; unread.set(String(m.jobId), u);
      }
      const L = (j) => `${on(j.orgId)} — ${j.propertyAddress || ""}`;
      const out = [];
      out.push(`Change orders waiting for a decision (${co.length})${me.role !== "admin" && co.length ? " — Elie decides" : ""}:`, ...(co.length ? co.map(({ r, j }) => `• ${L(j)}: ${r.label} — ${$(r.amount)}${r.note ? ` ("${String(r.note).slice(0, 120)}")` : ""} · asked by ${r.by || "contractor"} ${fmtDate(r.at)}`) : ["• none"]));
      out.push(`Bids in (${bids.length}):`, ...(bids.length ? bids.map((j) => `• ${L(j)}${j.title ? ` (${j.title})` : ""}: bid ${$(j.bidAmount)}${j.bidBy ? ` by ${j.bidBy}` : ""} ${fmtDate(j.bidAt)}`) : ["• none"]));
      const reqLine = (t) => { const j = byId.get(String(t.jobId)); return `• ${L(j)}: ${t.text}${(t.askedOf || []).length ? ` (asked of ${t.askedOf.map(first).join(", ")})` : ""} · ${t.createdBy || "contractor"} ${fmtDate(t.createdAt)}`; };
      out.push(`Requests asked of you (${mine.length}):`, ...(mine.length ? mine.map(reqLine) : ["• none"]));
      if (rest.length) out.push(`Other open requests to the team (${rest.length}):`, ...rest.slice(0, 20).map(reqLine));
      out.push(`Unread contractor messages (${[...unread.values()].reduce((s, u) => s + u.n, 0)}):`, ...(unread.size ? [...unread.entries()].map(([id, u]) => `• ${L(byId.get(id))}: ${u.n} new — last from ${first(u.last.author)} ${fmtDate(u.last.at)}: "${String(u.last.text || (u.last.attachment ? "[file]" : "")).slice(0, 140)}"`) : ["• none"]));
      return out.join("\n");
    }
    case "contractor_jobs": {
      const [jobs, orgs, tasks] = await Promise.all([loadJobs(db), rowsOf(db, "contractor_orgs"), rowsOf(db, "contractor_tasks")]);
      const on = orgNamer(orgs);
      let list = await matchJobs(db, a, jobs, orgs);
      if (!a.include_done) list = list.filter((j) => j.status !== "complete");
      if (!list.length) return "No contractor jobs match.";
      list.sort((x, y) => String(x.propertyAddress || "").localeCompare(String(y.propertyAddress || ""), undefined, { numeric: true }));
      return `${list.length} job${list.length === 1 ? "" : "s"}:\n` + list.slice(0, 60).map((j) => {
        const open = tasks.filter((t) => String(t.jobId) === String(j.id) && !ctrClosed(t.status));
        const pend = (j.coRequests || []).filter((r) => r.status === "pending").length;
        const money = me.role === "admin" ? (j.status === "bid" ? ` · bid ${j.bidAmount ? $(j.bidAmount) : "not in yet"}` : ` · contract ${$(jobTotal(j))}, paid ${$(jobPaid(j))}, left ${$(jobTotal(j) - jobPaid(j))}`) : "";
        return `• ${jobLabel(j, on)}${money}${open.length ? ` · ${open.length} open task${open.length === 1 ? "" : "s"}` : ""}${pend ? ` · ${pend} change order${pend === 1 ? "" : "s"} waiting` : ""}`;
      }).join("\n");
    }
    case "decide_change_order": {
      adminOnly(me);
      if (typeof a.approve !== "boolean") fail("Approve or deny?");
      const [jobs, orgs] = await Promise.all([loadJobs(db), rowsOf(db, "contractor_orgs")]);
      const on = orgNamer(orgs);
      const scoped = (a.job || a.property || a.contractor) ? await matchJobs(db, a, jobs, orgs) : jobs;
      let pend = scoped.flatMap((j) => (j.coRequests || []).filter((r) => r.status === "pending").map((r) => ({ r, j })));
      if (a.request) pend = pend.filter(({ r }) => norm(r.label).includes(norm(a.request)) || String(r.id) === String(a.request));
      if (!pend.length) fail("No pending change-order request matches.");
      if (pend.length > 1) fail(`That matches ${pend.length} requests: ${pend.slice(0, 8).map(({ r, j }) => `${on(j.orgId)} ${j.propertyAddress || ""}: ${r.label} ${$(r.amount)}`).join(" | ")}. Say which.`);
      if (a.confirmed !== true) fail("Not done. Show the user the request and get their OK, then call again with confirmed=true.");
      const { r, j } = pend[0];
      const at = nowIso();
      const upd = { ...j, coRequests: (j.coRequests || []).map((x) => (x.id === r.id ? { ...x, status: a.approve ? "approved" : "denied", decidedBy: me.name, decidedAt: at } : x)), ...(a.approve ? { changeOrders: [...(j.changeOrders || []), { id: Date.now(), label: r.label, amount: num(r.amount), date: at.slice(0, 10), by: r.by, fromRequest: r.id }] } : {}) };
      await saveJob(db, upd);
      try { await notifyFanout(db, me.id, { toOrg: j.orgId, title: a.approve ? "Change order approved ✓" : "Change order denied", body: `${r.label} — ${$(r.amount)}${a.approve ? ` · new contract total ${$(jobTotal(upd))}` : ""} · ${j.propertyAddress || ""}`, url: `/?goto=job:${j.id}` }); } catch { /* best effort */ }
      await ctrInsert(db, "contractor_messages", { id: newId(), jobId: j.id, orgId: j.orgId, author: me.name, side: "team", text: `🧾 Change order ${a.approve ? "approved ✓" : "denied"}: ${r.label} — ${$(r.amount)}`, at, readBy: [me.name], via: "claude" });
      return `${a.approve ? "Approved" : "Denied"}: ${r.label} — ${$(r.amount)} on ${jobLabel(j, on)}.${a.approve ? ` New contract total ${$(jobTotal(upd))}.` : ""} The contractor was notified.`;
    }
    case "contractor_messages": {
      const { job, on } = await oneJob(db, a);
      const msgs = (await rowsOf(db, "contractor_messages")).filter((m) => String(m.jobId) === String(job.id)).sort((x, y) => String(x.at).localeCompare(String(y.at)));
      if (!msgs.length) return `No messages yet on ${jobLabel(job, on)}.`;
      const lim = Math.max(1, Math.min(50, Number(a.limit) || 15));
      return `${jobLabel(job, on)} — last ${Math.min(lim, msgs.length)} messages:\n` + msgs.slice(-lim).map((m) => `• ${fmtDate(m.at)} ${first(m.author)}${m.side === "contractor" ? " (contractor)" : ""}${m.urgent ? " 🚨" : ""}: ${String(m.text || "").slice(0, 400)}${m.attachment ? ` [📎 ${m.attachment.name || "file"}]` : ""}`).join("\n");
    }
    case "message_contractor": {
      const text = String(a.text || "").trim();
      if (!text) fail("What's the message?");
      const { job, on } = await oneJob(db, a);
      if (a.confirmed !== true) fail(`Not sent. Show the user the message for ${jobLabel(job, on)}, get their OK, then call again with confirmed=true.`);
      await ctrInsert(db, "contractor_messages", { id: newId(), jobId: job.id, orgId: job.orgId, author: me.name, side: "team", text, at: nowIso(), readBy: [me.name], via: "claude" });
      try { await notifyFanout(db, me.id, { toOrg: job.orgId, title: `Goldstone — ${job.propertyAddress || ""}`, body: text, url: `/?goto=job:${job.id}` }); } catch { /* best effort */ }
      return `Sent to ${on(job.orgId)} in the ${job.propertyAddress || ""} job chat: "${text}"`;
    }
    case "deal_numbers": {
      adminOnly(me);
      const { p } = findProp(await loadProps(db), a.property);
      const f = p.financials || {};
      const pr = finProfit(f, p.status, (p.propertyInfo || {}).closingDateScheduled);
      const both = (proj, act) => `${num(proj) ? $(proj) : "—"}${num(act) ? ` (actual ${$(act)})` : ""}`;
      const draws = drawsForProperty(p, await rowsOf(db, "draws"));
      const open = draws.filter((d) => !d.paybackDate);
      const lines = [
        `${addrOf(p)} — ${p.status || "—"}`,
        `Purchase price: ${both(f.purchasePrice, f.actualPurchasePrice)}`,
        `ARV / sale price: ${both(f.salePrice, f.actualSalePrice)}`,
        `Rehab budget: ${both(f.rehabCosts, f.actualRehabCosts)}`,
        `Buying costs: ${$(pr.buyingTotal)} · Selling costs: ${$(pr.sellingTotal)} · Holding: ${$(pr.holdingTotal)} (${num(f.holdPeriod) || 0} mo)`,
        `Financing cost (hard money + gap): ${$(pr.debtService)} on a ${$(pr.hmLoanTotal)} hard-money loan`,
        `Projected net profit: ${$(pr.netProfit)}`,
        ...(num(f.actualSalePrice) ? [`Actual net profit: ${$(pr.acNet)}${pr.useActual ? " (the app shows this one)" : ""}`] : []),
        `Cash needed (equity): ${$(pr.equityRequired)}${pr.equityIsActual ? " (actual)" : " (estimate)"}`,
        `Private-lender money on it: ${open.length ? open.map((d) => `${d.funderName || "lender"} ${$(drawBalance(d))} + ${$(drawInterest(d))} interest @ ${pctRate(drawRate(d))}`).join("; ") : "none open"}${draws.length - open.length ? ` (${draws.length - open.length} paid back)` : ""}`,
      ];
      return lines.join("\n");
    }
    case "lender_balances": {
      adminOnly(me);
      const [funders, draws] = await Promise.all([rowsOf(db, "funders"), rowsOf(db, "draws")]);
      let fs = funders.filter((f) => !f.deleted);
      if (a.lender) { fs = fs.filter((f) => norm(f.name).includes(norm(a.lender))); if (!fs.length) fail(`No lender named "${a.lender}". Lenders: ${funders.map((f) => f.name).join(", ")}.`); }
      let prop = null;
      if (a.property) prop = findProp(await loadProps(db), a.property).p;
      const propDraws = prop ? new Set(drawsForProperty(prop, draws).map((d) => String(d.id))) : null;
      const blocks = [];
      let grand = 0;
      for (const f of fs) {
        const st = funderStats(f, draws);
        const open = st.open.filter((d) => !propDraws || propDraws.has(String(d.id)));
        if (prop && !open.length) continue;
        const owed = open.reduce((s, d) => s + drawBalance(d) + drawInterest(d), 0);
        grand += owed;
        blocks.push([`${f.name}${f.rate != null && f.rate !== "" ? ` (default ${f.rate}%)` : ""}: owed now ${$(owed)} on ${open.length} open loan${open.length === 1 ? "" : "s"}${prop ? "" : ` · capital ${$(st.capital)}, available ${$(st.available)}, interest owed ${$(st.interestOwed)}`}`,
          ...open.map((d) => `   • ${d.propertyLabel || "—"}: ${$(d.amount)} funded ${d.dateFunded || "?"} @ ${pctRate(drawRate(d))} — principal left ${$(drawBalance(d))} + interest ${$(drawInterest(d))} = ${$(drawBalance(d) + drawInterest(d))}`)].join("\n"));
      }
      if (!blocks.length) return prop ? `No open private-lender loans on ${addrOf(prop)}.` : "No lenders found.";
      return `${prop ? `Private-lender loans on ${addrOf(prop)}` : "Private lenders"} — total owed now ${$(grand)} (principal + interest to today):\n${blocks.join("\n")}`;
    }
    case "list_leads": {
      const days = Math.max(1, Math.min(365, Number(a.days) || 7));
      const since = Date.now() - days * 86400000;
      const q = norm(a.query);
      if (a.kind === "buyers") {
        const rows = (await rowsOf(db, "bt_leads")).filter((l) => !l.hidden && (!l.createdAt || Date.parse(l.createdAt) >= since));
        const list = rows.filter((l) => !q || norm(`${l.name} ${(l.tags || []).join(" ")}`).includes(q)).sort((x, y) => String(y.createdAt || "").localeCompare(String(x.createdAt || "")));
        if (!list.length) return `No buyer leads in the last ${days} days${q ? ` matching "${a.query}"` : ""}.`;
        return `${list.length} buyer lead${list.length === 1 ? "" : "s"} (last ${days} days):\n` + list.slice(0, 60).map((l) => `• ${l.name || "—"}${l.phone ? ` · ${l.phone}` : ""}${l.email ? ` · ${l.email}` : ""} — ${(l.tags || []).filter((t) => /^pb/i.test(String(t))).map((t) => String(t).replace(/^pb/i, "")).join(", ") || "no listing tag"}${l.createdAt ? ` · ${fmtDate(l.createdAt)}` : ""}`).join("\n");
      }
      const { data, error } = await db.from("leads").select("id,data");
      if (error) fail(`Couldn't load leads: ${error.message}`);
      const all = (data || []).map((r) => r.data).filter((l) => l && !l.deleted && !l.archived);
      const list = all.filter((l) => { const t = Date.parse(l.dateAdded || l.createdAt || ""); return isNaN(t) ? !!q : t >= since - 86400000; })
        .filter((l) => !q || norm(`${l.address} ${l.city} ${l.zip} ${(l.info || {}).sellerName}`).includes(q))
        .sort((x, y) => (Date.parse(y.dateAdded) || 0) - (Date.parse(x.dateAdded) || 0));
      if (!list.length) return `No seller leads added in the last ${days} days${q ? ` matching "${a.query}"` : ""} (${all.length} leads in total).`;
      return `${list.length} lead${list.length === 1 ? "" : "s"} (last ${days} days):\n` + list.slice(0, 60).map((l) => {
        const i = l.info || {};
        const open = (l.tasks || []).filter((t) => t && !t.deleted && !isDone(t)).length;
        return `• ${addrOf(l)} — added ${l.dateAdded || "?"}${i.source ? ` · source ${i.source}` : ""}\n   Seller: ${i.sellerName || "—"}${i.sellerPhone ? ` · ${i.sellerPhone}` : ""}${i.sellerEmail ? ` · ${i.sellerEmail}` : ""}${i.askingPrice ? ` · asking ${/^\$/.test(String(i.askingPrice)) ? i.askingPrice : $(num(i.askingPrice))}` : ""}${[i.beds && `${i.beds} bd`, i.baths && `${i.baths} ba`, i.sqft && `${i.sqft} sqft`].filter(Boolean).length ? ` · ${[i.beds && `${i.beds} bd`, i.baths && `${i.baths} ba`, i.sqft && `${i.sqft} sqft`].filter(Boolean).join(" ")}` : ""}${open ? ` · ${open} open task${open === 1 ? "" : "s"}` : ""}${l.notes ? `\n   Notes: ${String(l.notes).slice(0, 200)}` : ""}`;
      }).join("\n");
    }
    case "send_texts": {
      const list = (Array.isArray(a.texts) ? a.texts : []).filter((x) => x && x.to && String(x.message || "").trim());
      if (!list.length) fail("No texts to send.");
      if (list.length > 25) fail("That's more than 25 — send them in smaller batches.");
      if (a.confirmed !== true) fail("Not sent. Show the user every recipient and message, get ONE yes for the list, then call again with confirmed=true.");
      const out = [];
      let okN = 0;
      for (const x of list) {
        try { const r = await sendSmsAs(db, me, x.to, x.message, x.property); okN++; out.push(`✅ ${r.toName ? `${r.toName} (${r.to})` : r.to}: "${r.message}"`); }
        catch (e) { out.push(`❌ ${x.to}: ${e.message}`); }
      }
      return `Sent ${okN} of ${list.length} from ${first(me.name)}'s line:\n${out.join("\n")}`;
    }
    default:
      fail(`Unknown tool: ${name}`);
  }
  return "";
}
