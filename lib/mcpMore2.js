// 🤖 Claude connector — round 4 (Elie 10/14/26: "anything I can do with my mouse",
// except lenders + leads, which stay read-only): delete tasks, task contacts,
// property media, calendar key dates, Social Posts, and the Rental Portfolio
// (overview, one rental, delinquency, edits, tenant marks, moving a Platinum
// payment to another month). Same rules as the other tool files: runs as the
// signed-in teammate; destructive actions need confirmed=true.
import {
  fail, norm, addrOf, first, nowIso, newId, fmtDate, loadProps, findProp, saveProp, locate, findTask,
  STORAGE_PUBLIC, smsFor, showStartMs, nyWhen, showingMatchesProperty,
} from "./mcpTools.js";
import { fetchShowings } from "./showings.js";
import { e164, sameFirst } from "./jivetel.js";
import { defaultFields } from "./flyerFields.js";
import { liveModel } from "../src/platinumLive.js";
import { matchRental } from "../src/appfolio.js";
import { rentalMonthPL, ymNow, mLabel, isReversal } from "../src/rentalsEngine.js";
import { delinquency, todayIso } from "../src/rentalsDelinqEngine.js";
import { notifyFanout } from "./notify.js";

const OFFICE = "__office_task__";
const $ = (v) => `${v < 0 ? "-" : ""}$${Math.round(Math.abs(Number(v) || 0)).toLocaleString("en-US")}`;
const num = (v) => { const x = parseFloat(String(v ?? "").replace(/,/g, "")); return isNaN(x) ? 0 : x; };
const adminOnly = (me, what) => { if (me.role === "contractor") fail(`Only the Goldstone team can ${what}.`); };
const S = (props, required = []) => ({ type: "object", properties: props, required, additionalProperties: false });
const str = (d) => ({ type: "string", description: d });
const P = str('Property address (part is fine), or "company" for Company tasks.');
const ymOf = (v) => { const s = String(v || "").trim(); if (!s) return ""; if (/^\d{4}-\d{2}$/.test(s)) return s; const d = new Date(/\d{4}/.test(s) ? s : `${s} ${new Date().getFullYear()}`); if (isNaN(d)) fail(`I couldn't read the month "${v}". Use YYYY-MM.`); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const ymdOf = (v, label) => { const s = String(v || "").trim(); if (!s) return ""; if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; const d = new Date(/\d{4}/.test(s) ? s : `${s} ${new Date().getFullYear()}`); if (isNaN(d)) fail(`I couldn't read the ${label} "${v}". Use YYYY-MM-DD.`); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// ── Tasks: same helpers as the app (taskContactsOf / contactPatch / preserveTaskMsgs) ──
const taskContactsOf = (t) => (t ? (Array.isArray(t.taskContacts) ? t.taskContacts.filter(Boolean) : t.taskContact ? [t.taskContact] : []) : []);
const contactPatch = (tk, val, slot) => { const n = [...taskContactsOf(tk)]; if (slot === "new") { if (val) n.push(val); } else { const i = slot == null ? 0 : slot; if (val) n[i] = val; else n.splice(i, 1); } return { taskContacts: n, taskContact: n[0] || null }; };
const preserveTaskMsgs = (t) => ((t && t.messages) || []).map((m) => ({ ...m, taskId: t.id, taskText: t.text || "Untitled task", taskDeleted: true }));

// ── Media ──
const OWN_MEDIA = new Set(["app", "upload", "record", "claude"]);
function mediaOf(p) {
  const hidden = new Set((p.mediaHidden || []).map(String));
  const isPic = (a) => !!(a && a.url && (/^(image|video)\//.test(a.mime || "") || /\.(jpe?g|png|gif|webp|heic|mp4|mov)(\?|$)/i.test(a.name || a.url)));
  const out = (p.media || []).map((m) => ({ ...m, src: m.src || "app" }));
  (p.messages || []).forEach((m) => { if (m.attachment && isPic(m.attachment)) out.push({ id: `pm:${m.id}`, kind: /^video/.test(m.attachment.mime || "") ? "video" : "photo", url: m.attachment.url, name: m.attachment.name, at: Date.parse(m.at) || 0, by: m.author, src: "chat" }); });
  (p.tasks || []).forEach((t) => (t.messages || []).forEach((m) => { if (m.attachment && isPic(m.attachment)) out.push({ id: `tm:${t.id}:${m.id}`, kind: /^video/.test(m.attachment.mime || "") ? "video" : "photo", url: m.attachment.url, name: m.attachment.name, at: Date.parse(m.at) || 0, by: m.author, src: "chat" }); }));
  return out.filter((m) => !hidden.has(String(m.id))).sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
}
// Copy a picture link into our storage (same rules as api/spec/img.js).
async function mirrorPhoto(db, link) {
  const u = String(link || "").trim();
  if (!/^https?:\/\//i.test(u)) throw new Error("not a web link");
  if (u.startsWith(STORAGE_PUBLIC)) return { url: u, mime: "image/jpeg", size: 0 };
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 9000);
  let r;
  try { r = await fetch(u, { signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0 (Goldstone media)" } }); } finally { clearTimeout(tm); }
  if (!r.ok) throw new Error(`couldn't download (${r.status})`);
  const mime = String(r.headers.get("content-type") || "").split(";")[0].trim();
  if (!/^image\//.test(mime)) throw new Error("not a picture");
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 8 * 1024 * 1024) throw new Error("bigger than 8 MB");
  const ext = (mime.split("/")[1] || "jpg").replace("jpeg", "jpg").replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `media/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const up = await db.storage.from("attachments").upload(path, buf, { contentType: mime, upsert: false });
  if (up.error) throw new Error(up.error.message);
  return { url: db.storage.from("attachments").getPublicUrl(path).data.publicUrl, mime, size: buf.length };
}

// ── Calendar key dates (same as the app's CAL_EVENTS) ──
const CAL = [
  { type: "purchase", label: "Purchase / close", top: "financials", key: "purchaseDate", get: (p) => (p.financials || {}).purchaseDate, overdue: (p) => ["New Leads", "Under Contract"].includes(p.status), done: "Purchased", words: ["purchase", "buy", "acquisition"] },
  { type: "sale", label: "Sale closing", top: "propertyInfo", key: "closingDateScheduled", get: (p) => (p.status === "In Closing" ? (p.propertyInfo || {}).closingDateScheduled || (p.financials || {}).sellingDate || "" : ""), overdue: (p) => p.status !== "Sold", done: "Sold", words: ["sale", "sell", "closing", "close"] },
  { type: "inspectionDue", label: "Inspection due", top: "propertyInfo", key: "inspectionDue", get: (p) => (p.propertyInfo || {}).inspectionDue, overdue: () => true, done: null, words: ["inspection"] },
  { type: "mortgageCommitment", label: "Mortgage commitment", top: "propertyInfo", key: "mortgageCommitment", get: (p) => (p.propertyInfo || {}).mortgageCommitment, overdue: () => true, done: null, words: ["mortgage", "commitment"] },
];
const calType = (v) => { const q = norm(v); const e = CAL.find((c) => c.type.toLowerCase() === q.replace(/ /g, "") || c.words.some((w) => q.includes(w))); if (!e) fail(`Which date? purchase, sale closing, inspection due or mortgage commitment.`); return e; };
const todayYmd = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const dayLabel = (ymd) => { try { return new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); } catch { return ymd; } };
const addDaysYmd = (ymd, k) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };

// ── Social posts (app_settings "social_posts") ──
const KINDS = { purchased: "Just purchased", listed: "Just listed", sold: "Sold" };
const kindOf = (v) => { const q = norm(v); if (/purchas|acquir|bought|new project/.test(q)) return "purchased"; if (/list|market|available/.test(q)) return "listed"; if (/sold|sale/.test(q)) return "sold"; fail('Which post? "purchased", "listed" or "sold".'); };
async function loadPosts(db) {
  const { data } = await db.from("app_settings").select("data").eq("id", "social_posts").maybeSingle();
  return (data && data.data) || { id: "social_posts", items: [], seen: {} };
}
async function savePosts(db, fn) {
  const cur = await loadPosts(db);
  const next = { ...cur, ...fn(cur), id: "social_posts" };
  next.items = (next.items || []).slice(-200);
  const { error } = await db.from("app_settings").upsert({ id: "social_posts", data: next, updated_at: nowIso() }, { onConflict: "id" });
  if (error) fail(`Couldn't save: ${error.message}`);
  return next;
}
const upsertItem = (items, it) => [...(items || []).filter((x) => x.id !== it.id), { ...(items || []).find((x) => x.id === it.id), ...it, updatedAt: nowIso() }];

// ── Rentals (rentals table + app_settings "appfolio"), same context the Rentals page builds ──
async function rentalsCtx(db) {
  const [{ data: rows, error }, { data: af }] = await Promise.all([db.from("rentals").select("id,data"), db.from("app_settings").select("data").eq("id", "appfolio").maybeSingle()]);
  if (error) fail(`Couldn't load rentals: ${error.message}`);
  const recs = (rows || []).filter((r) => r && r.data).map((r) => ({ rowId: r.id, r: r.data })).sort((a, b) => String(a.r.address || "").localeCompare(String(b.r.address || ""), undefined, { numeric: true }));
  const list = recs.map((x) => x.r);
  const row = (af && af.data) || { statements: [], links: {} };
  const statements = [...(row.statements || [])].sort((a, b) => String(b.to).localeCompare(String(a.to)) || String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
  const links = row.links || {};
  const live = liveModel(row);
  const rentalFor = (prop) => { const id = links[prop.key]; if (id) return list.find((r) => String(r.id) === String(id)) || null; return matchRental(prop.name, list); };
  const liveProps = () => {
    const out = new Map(); const add = (key, name) => { if (key && !out.has(key)) out.set(key, { key, name }); };
    if (live) { Object.values(live.latest.props || {}).forEach((p) => add(p.key, p.name)); (live.latest.bills || []).forEach((b) => add(b.key, b.name)); live.txns.forEach((t) => add(t.key, t.name)); }
    statements.slice(0, 1).forEach((s) => (s.props || []).forEach((p) => !p.rollOnly && add(p.key, p.name)));
    return [...out.values()];
  };
  const keyFor = (r) => { if (!r) return null; const p = liveProps().find((x) => String(rentalFor(x)?.id) === String(r.id)); return p ? p.key : null; };
  const bAmt = (L, bucket, field) => { const ls = (L.qbLines || []).filter((x) => x.bucket === bucket); return ls.length ? Math.round(ls.reduce((s, x) => s + Math.abs(num(x.amount)), 0)) : num(L[field]); };
  const ctx = { live, keyFor, bAmt, packets: statements, rentalFor, basis: "for" };
  return { recs, list, ctx, live };
}
function findRental(recs, q) {
  const s = norm(q);
  if (!s) fail("Which rental? Give part of the address.");
  let hits = recs.filter((x) => norm(`${x.r.address} ${x.r.city || ""}`).includes(s));
  if (!hits.length) { const toks = s.split(" "); hits = recs.filter((x) => { const a = norm(`${x.r.address} ${x.r.city || ""}`); return toks.every((t) => a.includes(t)); }); }
  if (!hits.length) fail(`No rental matches "${q}". Rentals: ${recs.map((x) => x.r.address).join(", ")}.`);
  if (hits.length > 1) { const ex = hits.filter((x) => norm(x.r.address).startsWith(s)); if (ex.length === 1) return ex[0]; fail(`"${q}" matches ${hits.length} rentals: ${hits.map((x) => x.r.address).join(" | ")}.`); }
  return hits[0];
}
async function saveRental(db, rowId, fn) {
  const { data: row, error } = await db.from("rentals").select("data").eq("id", rowId).maybeSingle();
  if (error || !row) fail("Couldn't load that rental to save.");
  const next = fn(row.data);
  const { error: e2 } = await db.from("rentals").update({ data: next }).eq("id", rowId);
  if (e2) fail(`Couldn't save: ${e2.message}`);
  return next;
}
const rentStatus = (live, key) => {
  const p = live && key ? (live.latest.props || {})[key] : null;
  if (!p || !(p.rentDue > 0)) return "";
  const st = p.rentCollected >= p.rentDue - 0.5 ? "paid" : p.rentCollected > 0 ? "part paid" : "not paid";
  return `${mLabel(live.month)} rent ${st} (${$(p.rentCollected)} of ${$(p.rentDue)})`;
};
const pickUnit = (r, q) => {
  const units = r.units || [];
  if (!units.length) fail(`${r.address} has no units yet — add one with add_unit.`);
  if (!q) { if (units.length === 1) return units[0]; fail(`${r.address} has ${units.length} units: ${units.map((u) => `${u.label || "?"}${u.tenant && u.tenant.name ? ` (${u.tenant.name})` : ""}`).join(", ")}. Which one?`); }
  const s = norm(q);
  const hit = units.filter((u) => norm(u.label) === s || norm(u.label).replace(/^(unit|apt) /, "") === s.replace(/^(unit|apt|#) ?/, "")) .concat(units.filter((u) => u.tenant && norm(u.tenant.name).includes(s)));
  const uniq = [...new Set(hit)];
  if (uniq.length !== 1) fail(`No single unit matches "${q}". Units: ${units.map((u) => `${u.label || "?"}${u.tenant && u.tenant.name ? ` (${u.tenant.name})` : ""}`).join(", ")}.`);
  return uniq[0];
};

const UNIT_FIELDS = { unit_label: ["label", "Unit"], rent: ["rent", "Rent"], lease_start: ["leaseStart", "Lease start", "date"], lease_end: ["leaseEnd", "Lease end", "date"], lease_link: ["leaseLink", "Lease link"] };
const TENANT_FIELDS = { tenant_name: ["name", "Tenant"], tenant_phone: ["phone", "Tenant phone"], tenant_email: ["email", "Tenant email"] };
const MORTGAGE_FIELDS = { mortgage_payment: ["payment", "Mortgage payment"], mortgage_lender: ["lender", "Mortgage lender"], mortgage_rate: ["rate", "Mortgage rate"], mortgage_amount: ["amount", "Mortgage amount"] };


// ── Showing agents for one property (the property's Showings tab, server side) ──
// Same lead statuses + stable showing key as the app (SHOWING_LEADS / showingKey).
const SHOWING_LEADS = { buyer: "⭐ Selected buyer", received: "✅ Offer received", offer: "🔥 Expecting an offer", interest: "Expressed interest", not: "Not interested", badnum: "❌ Wrong number" };
const LEAD_RANK = ["buyer", "received", "offer", "interest", "", "not", "badnum"];
const showingKey = (s) => { const when = String(s.start || "").slice(0, 16); const who = String(s.agent || s.summary || s.location || "").trim().toLowerCase().replace(/\s+/g, " "); return when || who ? `${when}|${who}` : String(s.uid || ""); };
const parsePhones = (raw) => String(raw || "").split(/[,/;]|\bor\b/i).map((x) => x.trim()).filter((x) => x.replace(/[^\d]/g, "").length >= 7);
const leadOf = (v) => { const q = norm(v); if (!q || /^(clear|none|no status)$/.test(q)) return ""; if (/select|buyer/.test(q)) return "buyer"; if (/received|got (an )?offer/.test(q)) return "received"; if (/expect|offer/.test(q)) return "offer"; if (/not interest|no interest|pass/.test(q)) return "not"; if (/interest/.test(q)) return "interest"; if (/wrong|bad num/.test(q)) return "badnum"; fail('Lead status: selected buyer, offer received, expecting an offer, interested, not interested, wrong number, or clear.'); };
// Every agent who showed the property (live ShowingTime feed + saved snapshots + hand-added leads), grouped per agent.
async function showingAgents(db, p, days) {
  const since = Date.now() - days * 86400000;
  const leads = p.showingLeads || {}, snaps = p.showingSnapshots || {}, extraPh = p.showingPhones || {};
  const rows = new Map();
  const add = (s, key, status, src) => {
    const at = s.start ? (showStartMs(s) || Date.parse(s.start)) : (s.at ? Date.parse(s.at) : NaN);
    const phones = [...new Set([...parsePhones(s.phone), ...[].concat(extraPh[key] || [])].map((x) => e164(String(x))).filter(Boolean))];
    const id = phones[0] || norm(s.agent || s.name || key);
    const cur = rows.get(id) || { agent: s.agent || s.name || "", broker: s.broker || "", email: s.email || "", phones: [], shows: [], status: "", keys: [] };
    cur.phones = [...new Set([...cur.phones, ...phones])];
    if (!cur.agent) cur.agent = s.agent || s.name || ""; if (!cur.email && s.email) cur.email = s.email; if (!cur.broker && s.broker) cur.broker = s.broker;
    if (!isNaN(at)) (src === "custom" ? (cur.added = cur.added || at) : cur.shows.push(at));
    if (status && LEAD_RANK.indexOf(status) < LEAD_RANK.indexOf(cur.status || "")) cur.status = status;
    cur.keys.push({ key, src }); rows.set(id, cur);
  };
  let feedErr = "";
  try {
    const data = await fetchShowings();
    for (const s of data.showings || []) {
      if (!showingMatchesProperty(s.location || s.summary || "", p)) continue;
      const at = showStartMs(s);
      if (!isNaN(at) && at < since && !leads[showingKey(s)]) continue;
      add(s, showingKey(s), leads[showingKey(s)] || "", "feed");
    }
  } catch (e) { feedErr = e.message; }
  const seen = new Set([...rows.values()].flatMap((r) => r.keys.map((k) => k.key)));
  for (const [k, st] of Object.entries(leads)) if (!seen.has(k) && snaps[k]) add(snaps[k], k, st, "snap");
  for (const l of p.customLeads || []) add({ agent: l.name, phone: l.phone, at: l.at }, `lead-${l.id}`, l.lead || "", "custom");
  return { list: [...rows.values()].filter((r) => r.agent || r.phones.length), feedErr };
}


// ── Unread (same rules as the app) ───────────────────────────────────────────
// Team/office chats: isUnreadForUser — not mine, not in readBy, and either no
// @-mentions or I'm mentioned. Contractor chats: their side, not in readBy.
// Texts: incoming newer than my read stamp for that number (uprefs_<uid>.smsRead).
const unreadTeam = (m, me) => !!m && m.author !== me && !(m.readBy || []).includes(me) && (!(m.mentions || []).length || m.mentions.includes(me));
const unreadCtr = (m, me) => !!m && m.side !== "team" && !(m.readBy || []).includes(me);
const last10 = (x) => String(x || "").replace(/\D/g, "").slice(-10);
async function loadSmsRead(db, me) {
  const { data } = await db.from("app_settings").select("data").eq("id", `uprefs_${me.id}`).maybeSingle();
  return ((data && data.data) || {}).smsRead || {};
}
async function unreadTexts(db, me, days) {
  const readMap = await loadSmsRead(db, me);
  const { data } = await db.from("sms_messages").select("phone,data").order("updated_at", { ascending: false }).limit(3000);
  const rows = (data || []).map((r) => ({ ...(r.data || {}), phone: e164(r.phone || (r.data || {}).phone) })).filter((m) => m.phone && m.at && m.kind !== "call");
  const mine = new Set(rows.filter((m) => String(m.direction).startsWith("out") && sameFirst(m.by, me.name)).map((m) => m.phone));
  const since = days ? Date.now() - days * 86400000 : 0;
  const by = new Map();
  for (const m of rows) {
    if (m.direction !== "in" || String(m.at) <= String(readMap[m.phone] || "")) continue;
    if (me.role !== "admin" && !mine.has(m.phone)) continue;
    const c = by.get(m.phone) || { phone: m.phone, n: 0, last: null, old: true };
    c.n++; if (!c.last || String(m.at) > String(c.last.at)) c.last = m;
    if (Date.parse(m.at) >= since) c.old = false;
    by.set(m.phone, c);
  }
  return [...by.values()].sort((x, y) => String(y.last.at).localeCompare(String(x.last.at)));
}
async function contactNames(db) {
  const { data } = await db.from("contacts").select("data");
  const map = new Map();
  for (const c of (data || []).map((r) => r.data).filter(Boolean)) for (const ph of [...(c.phones || []).map((p) => p.number), c.phone]) { const k = last10(ph); if (k.length === 10 && !map.has(k)) map.set(k, c.name); }
  return map;
}

export const MORE2_TOOLS = [
  { name: "delete_task", title: "Delete a task", description: "Delete a task (its messages are kept in the chat, like the app does). Show the user which task and get a yes first; then confirmed=true.",
    inputSchema: S({ property: P, task: str("Task #id or words from its name."), confirmed: { type: "boolean" } }, ["property", "task", "confirmed"]), annotations: { destructiveHint: true } },
  { name: "task_contact", title: "Task contacts", description: "Attach a contact to a task (from the contacts directory by name, or a company), add a brand-new one just for this task, or remove one. A task can have several contacts.",
    inputSchema: S({ property: P, task: str("Task #id or words from its name."), add: str("Name of a person (or company) in the contacts directory to attach."), new_contact: { type: "object", description: "Someone not in the directory (saved on the task only).", properties: { name: { type: "string" }, phone: { type: "string" }, email: { type: "string" }, company: { type: "string" }, role: { type: "string" } }, required: ["name"], additionalProperties: false }, remove: str("Name of a contact to take off the task.") }, ["property", "task"]) },
  { name: "property_media", title: "Property photos", description: "The pictures and videos in a property's Media folder (uploads, Zillow photos, and pictures sent in its chats), newest first, with links and ids.",
    inputSchema: S({ property: str("Property address."), limit: { type: "integer", minimum: 1, maximum: 100 } }, ["property"]), annotations: { readOnlyHint: true } },
  { name: "add_photos", title: "Add photos to a property", description: "Copy picture links (e.g. Zillow/listing photo URLs) into a property's Media folder (up to 40). If a Social Post is waiting on Zillow photos for this property, that request is marked done.",
    inputSchema: S({ property: str("Property address."), links: { type: "array", items: { type: "string" }, maxItems: 40 }, name: str('Name for the photos (optional, e.g. "Zillow photo").') }, ["property", "links"]) },
  { name: "remove_media", title: "Remove a photo", description: "Take a picture/video out of a property's Media folder (by the id from property_media). Get the user's yes first; then confirmed=true.",
    inputSchema: S({ property: str("Property address."), item: str("Media id from property_media."), confirmed: { type: "boolean" } }, ["property", "item", "confirmed"]), annotations: { destructiveHint: true } },
  { name: "calendar", title: "Calendar", description: "The Calendar's key dates (purchase closings, sale closings, inspection due, mortgage commitment) for the next N days plus overdue ones still waiting, and contractors' scheduled site events. (Showings: use list_showings.)",
    inputSchema: S({ days: { type: "integer", minimum: 1, maximum: 120, description: "Days ahead (default 14)." }, property: str("Only this property (optional).") }), annotations: { readOnlyHint: true } },
  { name: "calendar_update", title: "Update a calendar date", description: 'Act on a key date like the Calendar buttons: move it to a new date, dismiss it, or mark it done ("done" on a purchase date sets the property to Purchased; on a sale closing, to Sold).',
    inputSchema: S({ property: str("Property address."), date: str("purchase, sale closing, inspection due, or mortgage commitment."), action: { type: "string", enum: ["move", "dismiss", "done"] }, to_date: str("New date (YYYY-MM-DD) when moving.") }, ["property", "date", "action"]) },
  { name: "social_posts", title: "Social posts", description: "ADMIN ONLY. The Social Posts list: drafts waiting for approval, approved posts ready to go on Facebook (image + caption links), posted ones, and Zillow-photo requests.",
    inputSchema: S({ status: { type: "string", enum: ["draft", "approved", "posted", "all"] } }), annotations: { readOnlyHint: true } },
  { name: "social_post", title: "Work on a social post", description: 'ADMIN ONLY. For a property\'s "purchased" / "listed" / "sold" post: create a draft (optionally with a caption), change the caption, mark it posted, dismiss it ("not this one"), remove it, or request Zillow photos (zillow_url). Approving the flyer picture itself is done in the app (it draws the flyer).',
    inputSchema: S({ property: str("Property address."), kind: str("purchased, listed or sold."), action: { type: "string", enum: ["draft", "caption", "posted", "dismiss", "remove", "zillow"] }, caption: str("Facebook caption (draft/caption)."), zillow_url: str("Zillow / Redfin / Realtor / Homes.com listing link (zillow).") }, ["property", "kind", "action"]) },
  { name: "showing_agents", title: "Agents who showed a property", description: "Every agent who showed one property (ShowingTime + saved showings + hand-added leads), grouped per agent: showing date(s), phone/email/brokerage, the lead status set in the app, and the text conversation with them since the showing (who replied, what they said). Use it to find interested agents and draft a tailored follow-up for each; send with send_texts after the user approves the list.",
    inputSchema: S({ property: str("Property address."), days: { type: "integer", minimum: 7, maximum: 365, description: "How far back to look in ShowingTime (default 120). Agents with a lead status are always included." }, replied_only: { type: "boolean", description: "Only agents who texted back." } }, ["property"]), annotations: { readOnlyHint: true } },
  { name: "set_showing_lead", title: "Set an agent's lead status", description: "Set the lead status on a showing agent for a property, like the dropdown on the Showings tab: selected buyer, offer received, expecting an offer, interested, not interested, wrong number, or clear.",
    inputSchema: S({ property: str("Property address."), agent: str("Agent name or phone."), status: str("New status.") }, ["property", "agent", "status"]) },
  { name: "unread_messages", title: "My unread messages", description: "What's unread for the signed-in teammate in the app, using the app's own rules: property team chats (and task chats), the Office Chat, contractor job chats, and text messages. Shows who/where, how many, and the latest message.",
    inputSchema: S({ days: { type: "integer", minimum: 1, maximum: 365, description: "Only texts from the last N days (default 30; older unread texts are counted, not listed)." } }), annotations: { readOnlyHint: true } },
  { name: "mark_read", title: "Mark messages as read", description: 'Mark messages read in the app for the signed-in teammate (their unread badges clear). what = "all" (everything unread), "team" (all property/task chats), "office", "contractors", "texts" — or narrow with property / contractor / phone_or_contact.',
    inputSchema: S({ what: { type: "string", enum: ["all", "team", "office", "contractors", "texts"] }, property: str("Only this property's team chat (+ its contractor job chats)."), contractor: str("Only this contractor company's job chats."), phone_or_contact: str("Only this text conversation (number or contact name).") }) },
  { name: "rentals_overview", title: "Rental portfolio", description: "Every rental: units, monthly rent roll, this month's money in / expenses / net / cash flow after mortgage (same numbers as the Rentals dashboard), Platinum rent status, and what tenants owe.",
    inputSchema: S({ month: str("YYYY-MM (default this month).") }), annotations: { readOnlyHint: true } },
  { name: "rental_details", title: "One rental", description: "One rental: units, tenants, rent, leases, mortgage, the month's income/expense breakdown, Platinum rent status, recent Platinum payments, and each tenant's balance.",
    inputSchema: S({ rental: str("Rental address."), month: str("YYYY-MM (default this month).") }, ["rental"]), annotations: { readOnlyHint: true } },
  { name: "delinquency_report", title: "Who owes rent", description: "The Delinquency report: every tenant behind on rent as of a date (default today) — what they owe, aged 0-30/31-60/61-90/90+, last payment — with totals.",
    inputSchema: S({ as_of: str("YYYY-MM-DD (default today)."), rental: str("Only this rental (optional)."), include_paid: { type: "boolean", description: "Also list tenants who are paid up." } }), annotations: { readOnlyHint: true } },
  { name: "update_rental", title: "Update a rental", description: "Edit a rental like its Details tab: a unit's label, rent, lease start/end, lease link, tenant name/phone/email; the mortgage payment/lender/rate/amount; add a unit (add_unit) or remove one (remove_unit + confirmed).",
    inputSchema: S({ rental: str("Rental address."), unit: str("Which unit (label or tenant name) — needed on multi-unit rentals."), ...Object.fromEntries(Object.entries({ ...UNIT_FIELDS, ...TENANT_FIELDS, ...MORTGAGE_FIELDS }).map(([k, [, l, t]]) => [k, str(`${l}${t === "date" ? " (YYYY-MM-DD)" : ""}.`)])), add_unit: str("Label of a new unit to add (optional)."), remove_unit: { type: "boolean", description: "Remove the chosen unit (needs confirmed=true)." }, confirmed: { type: "boolean" } }, ["rental"]) },
  { name: "mark_tenant", title: "Mark a tenant", description: 'Delinquency report marks: "vacant" (nobody there — balance wiped, not counted), "new_tenant" from a month (ledger starts fresh that month), or "clear" to undo.',
    inputSchema: S({ rental: str("Rental address."), unit: str("Unit label or tenant name (multi-unit rentals)."), mark: { type: "string", enum: ["vacant", "new_tenant", "clear"] }, from_month: str("YYYY-MM the new tenant moved in (new_tenant).") }, ["rental", "mark"]) },
  { name: "move_rental_payment", title: "Move a Platinum payment to another month", description: 'Like "For ▾" in the payments popup: count a Platinum payment toward another month, split it across months, or put it back to automatic. Find it by words/amount/date; the tool lists matches if it\'s not clear.',
    inputSchema: S({ rental: str("Rental address."), payment: str("Words, amount or date of the payment (e.g. \"1250 Sep 3\")."), to_month: str("YYYY-MM to count it in."), split: { type: "array", items: { type: "object", properties: { month: { type: "string" }, amount: { type: "number" } }, required: ["month", "amount"], additionalProperties: false } }, automatic: { type: "boolean", description: "Undo — back to the month written on it." } }, ["rental", "payment"]) },
  // 🎯 Reverse prospecting (Elie 10/27/26) — Cowork's Monday/Thursday MLS check.
  { name: "reverse_listings", title: "Reverse-prospecting listings", description: "Our listings to check for reverse-prospecting agents (On Market, or any with an MLS set): which MLS each is in (name, website, notes), its MLS #, when it was last checked, and the agents we already have (so only NEW agents, or ones still missing a cell, need their MLS business card opened). Call this first on a reverse-prospecting run.",
    inputSchema: S({}), annotations: { readOnlyHint: true } },
  { name: "add_reverse_agents", title: "Add reverse-prospecting agents", description: "Add the buyer's agents found on MLS reverse-prospecting reports to our listings' 🎯 Reverse tab, in ONE call for the whole run. cell = the MOBILE/CELL number from the agent's business card (never an office/main line — leave it empty if no mobile is shown; office_phone holds the other number). Agents already on a listing are matched by cell, email or name and only filled in. Marks each listing checked and sends the teammate ONE push summarizing what's new (skipped when nothing is new). Nothing is texted.",
    inputSchema: S({
      listings: { type: "array", description: "One entry per listing checked (include listings with no new agents, so they're marked checked).", items: { type: "object", additionalProperties: false, required: ["property", "agents"], properties: {
        property: str("Listing address (part is fine)."),
        agents: { type: "array", items: { type: "object", additionalProperties: false, required: ["name"], properties: {
          name: str("Agent's full name."), cell: str("Mobile/cell number from the business card, or empty."), office_phone: str("Office/main number, if shown."),
          email: str("Email."), office: str("Brokerage / office name."), buyers: { type: "integer", minimum: 1, maximum: 99, description: "How many of their buyers/searches matched (1 if not shown)." }, note: str("Short note (price range, towns, date) — optional."),
        } } },
        mls_number: str("The listing's MLS # if you saw it (saved for next time)."),
      } } },
      notify: { type: "boolean", description: "Send the summary push (default true)." },
    }, ["listings"]) },
];

export async function runMore2(db, name, a, me) {
  switch (name) {
    case "delete_task": {
      const loc = await locate(db, a.property);
      const t = findTask(loc.tasks, a.task, loc.label);
      if (a.confirmed !== true) fail(`Not deleted. Confirm with the user: delete "${t.text}" on ${loc.label}? Then call again with confirmed=true.`);
      const keep = preserveTaskMsgs(t);
      if (loc.pid === OFFICE) {
        const { data } = await db.from("office_tasks").select("id,data");
        const row = (data || []).find((r) => r.data && String(r.data.id) === String(t.id));
        if (!row) fail("Couldn't find that company task to delete.");
        for (const m of keep) await db.from("office_messages").upsert({ id: String(m.id), data: m }, { onConflict: "id" });
        const { error } = await db.from("office_tasks").delete().eq("id", row.id);
        if (error) fail(`Couldn't delete: ${error.message}`);
      } else {
        const { rowId } = findProp(await loadProps(db), a.property);
        await saveProp(db, rowId, (p) => ({ ...p, tasks: (p.tasks || []).filter((x) => String(x.id) !== String(t.id)), messages: keep.length ? [...(p.messages || []), ...keep] : (p.messages || []) }));
      }
      return `Deleted "${t.text}" on ${loc.label}${keep.length ? ` (its ${keep.length} message${keep.length === 1 ? " was" : "s were"} kept in the chat)` : ""}.`;
    }
    case "task_contact": {
      const loc = await locate(db, a.property);
      const t0 = findTask(loc.tasks, a.task, loc.label);
      if (!a.add && !a.new_contact && !a.remove) {
        const cs = taskContactsOf(t0);
        return cs.length ? `Contacts on "${t0.text}": ${cs.map((c) => c.name).join(", ")}.` : `"${t0.text}" has no contacts yet.`;
      }
      let val = null, slot = "new", said = "";
      if (a.remove) {
        const cs = taskContactsOf(t0);
        const i = cs.findIndex((c) => norm(c.name).includes(norm(a.remove)));
        if (i < 0) fail(`"${a.remove}" isn't on this task. Contacts: ${cs.map((c) => c.name).join(", ") || "none"}.`);
        slot = i; said = `Removed ${cs[i].name} from`;
      } else if (a.new_contact) {
        const c = a.new_contact;
        val = { kind: "person", id: Date.now(), name: String(c.name).trim(), company: c.company || "", role: c.role || "", email: c.email || "", phones: c.phone ? [{ label: "Mobile", number: String(c.phone).trim() }] : [], tags: [] };
        said = `Added ${val.name} to`;
      } else {
        const q = norm(a.add);
        const { data } = await db.from("contacts").select("data");
        const all = (data || []).map((r) => r.data).filter(Boolean);
        let hits = all.filter((c) => norm(c.name) === q);
        if (!hits.length) hits = all.filter((c) => norm(c.name).includes(q));
        if (hits.length > 1) fail(`"${a.add}" matches ${hits.length} contacts: ${hits.slice(0, 6).map((c) => c.name).join(", ")}. Which one?`);
        if (hits.length === 1) val = { kind: "person", id: hits[0].id, name: hits[0].name };
        else {
          const co = all.find((c) => c.company && norm(c.company) === q) || all.find((c) => c.company && norm(c.company).includes(q));
          if (!co) fail(`No one named "${a.add}" in contacts. Use new_contact to add them just to this task (or save_contact to put them in the directory).`);
          val = { kind: "company", name: co.company };
        }
        if (taskContactsOf(t0).some((c) => norm(c.name) === norm(val.name))) return `${val.name} is already on "${t0.text}".`;
        said = `Added ${val.name}${val.kind === "company" ? " (company)" : ""} to`;
      }
      const next = await loc.update(t0.id, (t) => ({ ...t, ...contactPatch(t, val, slot) }));
      return `${said} "${next.text}" (${loc.label}). Contacts now: ${taskContactsOf(next).map((c) => c.name).join(", ") || "none"}.`;
    }
    case "property_media": {
      const { p } = findProp(await loadProps(db), a.property);
      const items = mediaOf(p);
      if (!items.length) return `${addrOf(p)}'s Media folder is empty.`;
      const lim = Math.max(1, Math.min(100, Number(a.limit) || 30));
      return `${addrOf(p)} — ${items.length} item${items.length === 1 ? "" : "s"}${items.length > lim ? ` (newest ${lim})` : ""}:\n` + items.slice(0, lim).map((m) => `• ${m.kind === "video" ? "🎬" : "🖼"} ${m.name || m.kind} — ${m.src === "chat" ? "from chat" : m.src}${m.by ? ` · ${first(m.by)}` : ""}${m.at ? ` · ${fmtDate(Number(m.at) ? new Date(Number(m.at)).toISOString() : m.at)}` : ""}\n   ${m.url}\n   id: ${m.id}`).join("\n");
    }
    case "add_photos": {
      const links = [...new Set((a.links || []).map((x) => String(x || "").trim()).filter((x) => /^https?:\/\//i.test(x)))].slice(0, 40);
      if (!links.length) fail("Give the picture links to add.");
      const { rowId, p } = findProp(await loadProps(db), a.property);
      const posts = await loadPosts(db);
      const wanted = (posts.items || []).filter((it) => String(it.propId) === String(p.id) && it.zillowWanted);
      const src = wanted.length ? "zillow" : "claude";
      const added = [], bad = [];
      for (let i = 0; i < links.length; i++) {
        try { const m = await mirrorPhoto(db, links[i]); added.push({ id: `p:${Date.now()}:${i}`, kind: "photo", url: m.url, thumb: m.url, name: a.name || (src === "zillow" ? "Zillow photo" : "Photo"), mime: m.mime, ...(m.size ? { size: m.size } : {}), at: Date.now() + i, by: me.name, src, from: links[i] }); }
        catch (e) { bad.push(`${links[i].slice(0, 80)} (${e.name === "AbortError" ? "timed out" : e.message})`); }
      }
      if (added.length) {
        await saveProp(db, rowId, (x) => ({ ...x, media: [...(x.media || []), ...added] }));
        if (wanted.length) await savePosts(db, (cur) => ({ items: wanted.reduce((items, it) => upsertItem(items, { id: it.id, zillowWanted: null, zillowDoneAt: nowIso() }), cur.items || []) }));
      }
      return `Added ${added.length} of ${links.length} photo${links.length === 1 ? "" : "s"} to ${addrOf(p)}'s Media${wanted.length && added.length ? " (the Zillow-photo request is done)" : ""}.${bad.length ? `\nCouldn't add: ${bad.join("; ")}` : ""}`;
    }
    case "remove_media": {
      const { rowId, p } = findProp(await loadProps(db), a.property);
      const item = mediaOf(p).find((m) => String(m.id) === String(a.item).trim());
      if (!item) fail(`No media with id "${a.item}" on ${addrOf(p)} — use property_media to see the ids.`);
      if (a.confirmed !== true) fail(`Not removed. Confirm with the user: remove "${item.name || item.kind}" from ${addrOf(p)}'s Media? Then call again with confirmed=true.`);
      await saveProp(db, rowId, (x) => (OWN_MEDIA.has(item.src) ? { ...x, media: (x.media || []).filter((m) => String(m.id) !== String(item.id)) } : { ...x, mediaHidden: [...new Set([...(x.mediaHidden || []), item.id])] }));
      return `Removed "${item.name || item.kind}" from ${addrOf(p)}'s Media.`;
    }
    case "calendar": {
      const days = Math.max(1, Math.min(120, Number(a.days) || 14));
      let props = (await loadProps(db)).map((r) => r.p);
      if (a.property) { const { p } = findProp(await loadProps(db), a.property); props = [p]; }
      const today = todayYmd(), end = addDaysYmd(today, days);
      const rows = [];
      for (const p of props) for (const e of CAL) {
        const d = String(e.get(p) || "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || (p.calDismissed || {})[`${e.type}:${d}`]) continue;
        if (d >= today && d <= end) rows.push({ d, txt: `${e.label} — ${addrOf(p)}` });
        else if (d < today && e.overdue(p)) rows.push({ d, txt: `${e.label} — ${addrOf(p)} (passed, still open)`, late: true });
      }
      try {
        const { data: st } = await db.from("site_status").select("id,data");
        const byId = new Map(props.map((p) => [String(p.id), p]));
        for (const r of st || []) { const p = byId.get(String(r.id)); if (!p) continue; for (const ev of (r.data && r.data.events) || []) { if (ev.date >= today && ev.date <= end) rows.push({ d: ev.date, txt: `👷 ${ev.customLabel || ev.type || "Site event"}${ev.trade ? ` (${ev.trade})` : ""}${ev.time ? ` ${ev.time}` : ""} — ${addrOf(p)}${ev.orgName ? ` · ${ev.orgName}` : ""}${ev.note ? ` · ${String(ev.note).slice(0, 80)}` : ""}` }); } }
      } catch { /* optional */ }
      if (!rows.length) return `Nothing on the calendar in the next ${days} days.`;
      rows.sort((x, y) => x.d.localeCompare(y.d));
      return `Calendar (next ${days} days${rows.some((r) => r.late) ? " + overdue" : ""}):\n` + rows.map((r) => `• ${r.late ? "⚠ " : ""}${dayLabel(r.d)} — ${r.txt}`).join("\n") + "\n(Showings: ask for list_showings.)";
    }
    case "calendar_update": {
      const e = calType(a.date);
      const { rowId, p } = findProp(await loadProps(db), a.property);
      const cur = String(e.get(p) || (e.type === "sale" ? (p.propertyInfo || {}).closingDateScheduled || (p.financials || {}).sellingDate || "" : "")).slice(0, 10);
      if (a.action === "move") {
        const d = ymdOf(a.to_date, "new date");
        if (!d) fail("Move it to which date?");
        await saveProp(db, rowId, (x) => ({ ...x, [e.top]: { ...(x[e.top] || {}), [e.key]: d } }));
        return `${addrOf(p)}: ${e.label} moved ${cur ? `from ${dayLabel(cur)} ` : ""}to ${dayLabel(d)}.`;
      }
      if (!cur) fail(`${addrOf(p)} has no ${e.label.toLowerCase()} date on the calendar.`);
      const k = `${e.type}:${cur}`;
      if (a.action === "dismiss") {
        await saveProp(db, rowId, (x) => ({ ...x, calDismissed: { ...(x.calDismissed || {}), [k]: true } }));
        return `${addrOf(p)}: ${e.label} (${dayLabel(cur)}) dismissed from the calendar.`;
      }
      await saveProp(db, rowId, (x) => ({ ...x, ...(e.done ? { status: e.done } : {}), calDismissed: { ...(x.calDismissed || {}), [k]: true } }));
      return `${addrOf(p)}: ${e.label} marked done${e.done ? ` — status is now ${e.done}` : ""}.`;
    }
    case "social_posts": {
      adminOnly(me, "see Social Posts");
      const posts = await loadPosts(db);
      const props = new Map((await loadProps(db)).map((r) => [String(r.p.id), r.p]));
      const want = a.status && a.status !== "all" ? a.status : null;
      const items = (posts.items || []).filter((it) => it.status !== "dismissed" && (!want || it.status === want)).sort((x, y) => String(y.updatedAt || y.createdAt || "").localeCompare(String(x.updatedAt || x.createdAt || "")));
      if (!items.length) return want ? `No ${want} posts.` : "No social posts right now.";
      const lab = { draft: "Draft — waiting for your approval in the app", approved: "Ready to post", posted: "Posted" };
      return items.slice(0, 40).map((it) => { const p = props.get(String(it.propId)); return `• ${KINDS[it.kind] || it.kind} — ${p ? addrOf(p) : `property ${it.propId}`}: ${lab[it.status] || it.status}${it.postedAt ? ` ${fmtDate(it.postedAt)}` : ""}${it.zillowWanted ? " · waiting on Zillow photos" : ""}${it.imageUrl ? `\n   Image: ${it.imageUrl}` : ""}${(it.caption || (it.fields && it.fields.caption)) ? `\n   Caption: ${String(it.caption || it.fields.caption).slice(0, 300)}` : ""}`; }).join("\n");
    }
    case "social_post": {
      adminOnly(me, "work on Social Posts");
      const kind = kindOf(a.kind);
      const { rowId, p } = findProp(await loadProps(db), a.property);
      const id = `${p.id}:${kind}`;
      const posts = await loadPosts(db);
      const it = (posts.items || []).find((x) => x.id === id);
      const label = `${KINDS[kind]} post for ${addrOf(p)}`;
      const need = () => { if (!it || it.status === "dismissed") fail(`There's no ${label} yet — create a draft first.`); };
      switch (a.action) {
        case "draft": {
          if (it && it.status !== "dismissed") return `A ${label} already exists (${it.status}).${a.caption ? " Use action caption to change its caption." : ""}`;
          const fields = a.caption ? { ...defaultFields(p, kind), caption: String(a.caption) } : null;
          await savePosts(db, (cur) => ({ items: upsertItem(cur.items, { id, propId: p.id, kind, status: "draft", auto: false, createdAt: nowIso(), fields, photos: null, imageUrl: null, approvedAt: null, postedAt: null }) }));
          return `Draft ${label} created — open Social Posts in the app to pick photos and approve the flyer.`;
        }
        case "caption": {
          need(); if (!String(a.caption || "").trim()) fail("What should the caption say?");
          const fields = { ...(it.fields || defaultFields(p, kind)), caption: String(a.caption) };
          await savePosts(db, (cur) => ({ items: upsertItem(cur.items, { id, fields, ...(it.status === "approved" || it.status === "posted" ? { caption: String(a.caption) } : {}) }) }));
          return `Caption updated on the ${label}.`;
        }
        case "posted": need(); await savePosts(db, (cur) => ({ items: upsertItem(cur.items, { id, status: "posted", postedAt: nowIso() }) })); return `Marked the ${label} as posted.`;
        case "dismiss": need(); await savePosts(db, (cur) => ({ items: upsertItem(cur.items, { id, status: "dismissed" }) })); return `Dismissed the ${label} ("not this one").`;
        case "remove": need(); await savePosts(db, (cur) => ({ items: (cur.items || []).filter((x) => x.id !== id) })); return `Removed the ${label}.`;
        case "zillow": {
          const url = String(a.zillow_url || "").trim();
          if (!/^https?:\/\/(www\.)?(zillow|redfin|realtor|homes)\.com\//i.test(url)) fail("Give the Zillow / Redfin / Realtor.com / Homes.com listing link.");
          await saveProp(db, rowId, (x) => ({ ...x, zillowUrl: url }));
          await savePosts(db, (cur) => ({ items: upsertItem(cur.items, { id, propId: p.id, kind, ...(it ? {} : { status: "draft", auto: false, createdAt: nowIso(), fields: null, photos: null }), zillowUrl: url, zillowWanted: nowIso() }) }));
          return `Zillow photos requested for the ${label} — your Cowork picks it up ("get the Zillow photos"), or send me the photo links and I'll add them with add_photos.`;
        }
        default: fail("Unknown action.");
      }
      return "";
    }
    case "showing_agents": {
      const { p } = findProp(await loadProps(db), a.property);
      const days = Math.max(7, Math.min(365, Number(a.days) || 120));
      const { list, feedErr } = await showingAgents(db, p, days);
      if (!list.length) return `No showings found for ${addrOf(p)} in the last ${days} days${feedErr ? ` (ShowingTime: ${feedErr})` : ""}.`;
      const sms = await smsFor(db, list.flatMap((r) => r.phones), me);
      const now = Date.now();
      const out = list.map((r) => {
        const first0 = r.shows.length ? Math.min(...r.shows) : r.added || now - days * 86400000;
        const thread = sms.filter((m) => r.phones.includes(m.phone) && m.kind !== "call" && Date.parse(m.at) >= first0 - 86400000).sort((x, y) => String(x.at).localeCompare(String(y.at)));
        const replies = thread.filter((m) => m.direction === "in");
        return { ...r, thread, replies, last: thread.length ? Date.parse(thread[thread.length - 1].at) : 0, upcoming: r.shows.length && Math.max(...r.shows) > now };
      }).filter((r) => !a.replied_only || r.replies.length)
        .sort((x, y) => (LEAD_RANK.indexOf(x.status || "") - LEAD_RANK.indexOf(y.status || "")) || (!!y.replies.length - !!x.replies.length) || (y.last - x.last));
      if (!out.length) return `Nobody who showed ${addrOf(p)} has texted back yet${me.role !== "admin" ? " (in threads you're part of)" : ""}.`;
      const blocks = out.map((r) => {
        const shows = [...new Set(r.shows.map((t) => nyWhen(new Date(t).toISOString())))].join(", ");
        const lines = r.thread.slice(-8).map((m) => `     ${nyWhen(m.at)} ${m.direction === "in" ? "← agent" : `→ ${first(m.by) || "us"}`}: ${String(m.text || (m.media ? "[picture]" : "")).replace(/\s+/g, " ").slice(0, 280)}`);
        return [`• ${r.agent || "Agent"}${r.broker ? ` (${r.broker})` : ""}${r.status ? ` — ${SHOWING_LEADS[r.status]}` : ""}${r.upcoming ? " — showing coming up" : ""}`,
          `   ${shows ? `Showed: ${shows}` : r.added ? `Added as a lead ${nyWhen(new Date(r.added).toISOString())}` : "Showing date unknown"} · ${r.phones.join(", ") || "no phone on file"}${r.email ? ` · ${r.email}` : ""}`,
          r.thread.length ? `   Texts since the showing (${r.replies.length} repl${r.replies.length === 1 ? "y" : "ies"}):\n${lines.join("\n")}` : "   No texts with them since the showing."].join("\n");
      });
      const replied = out.filter((r) => r.replies.length).length;
      return `${addrOf(p)} — ${out.length} agent${out.length === 1 ? "" : "s"}${a.replied_only ? " who replied" : ` (${replied} replied)`}${feedErr ? ` · ShowingTime unreachable: ${feedErr}` : ""}:\n${blocks.join("\n")}\n\nTo follow up: read each reply, suggest a tailored text per agent, show the full list, and after the user's yes use send_texts (property set, so it files under this property).`;
    }
    case "set_showing_lead": {
      const st = leadOf(a.status);
      const { rowId, p } = findProp(await loadProps(db), a.property);
      const { list } = await showingAgents(db, p, 365);
      const q = norm(a.agent), digits = String(a.agent || "").replace(/\D/g, "").slice(-10);
      const hits = list.filter((r) => (q && norm(r.agent).includes(q)) || (digits.length >= 7 && r.phones.some((ph) => ph.replace(/\D/g, "").endsWith(digits))));
      if (!hits.length) fail(`No agent like "${a.agent}" showed ${addrOf(p)}.`);
      if (hits.length > 1) fail(`"${a.agent}" matches ${hits.length} agents: ${hits.map((r) => r.agent).join(", ")}.`);
      const r = hits[0];
      // The newest showing by that agent carries the status (custom leads keep theirs on the lead).
      const custom = r.keys.find((k) => k.src === "custom");
      const pick = r.keys.filter((k) => k.src !== "custom").sort((x, y) => String(y.key).localeCompare(String(x.key)))[0];
      const data = await fetchShowings().catch(() => ({ showings: [] }));
      await saveProp(db, rowId, (x) => {
        if (!pick && custom) { const id = String(custom.key).slice(5); return { ...x, customLeads: (x.customLeads || []).map((l) => (String(l.id) === id ? { ...l, lead: st } : l)) }; }
        const leads = { ...(x.showingLeads || {}) };
        if (st) leads[pick.key] = st; else delete leads[pick.key];
        const next = { ...x, showingLeads: leads };
        if (st && !(x.showingSnapshots || {})[pick.key]) {
          const s = (data.showings || []).find((y) => showingKey(y) === pick.key);
          if (s) next.showingSnapshots = { ...(x.showingSnapshots || {}), [pick.key]: { uid: s.uid || "", start: s.start || "", summary: s.summary || "", location: s.location || "", agent: s.agent || "", broker: s.broker || "", phone: s.phone || "", email: s.email || "", status: s.status || "" } };
        }
        if (st === "buyer") next.selectedBuyer = { agent: r.agent || "", broker: r.broker || "", phone: r.phones[0] || "", email: r.email || "" };
        else if ((x.showingLeads || {})[pick.key] === "buyer") next.selectedBuyer = null;
        return { ...next, statusLog: { ...(x.statusLog || {}), [pick.key]: { at: nowIso(), by: me.name } } };
      });
      return `${r.agent || "Agent"} on ${addrOf(p)}: ${st ? SHOWING_LEADS[st] : "status cleared"}.`;
    }
    case "unread_messages": {
      const days = Math.max(1, Math.min(365, Number(a.days) || 30));
      const name = me.name;
      const props = (await loadProps(db)).map((r) => r.p);
      const team = [];
      for (const p of props) {
        const msgs = [...(p.messages || []).map((m) => ({ m, where: "chat" })), ...(p.tasks || []).filter((t) => t && !t.deleted).flatMap((t) => (t.messages || []).map((m) => ({ m, where: `task "${t.text}"` })))];
        const un = msgs.filter((x) => unreadTeam(x.m, name)).sort((x, y) => String(x.m.at).localeCompare(String(y.m.at)));
        if (un.length) team.push({ p, un });
      }
      const { data: om } = await db.from("office_messages").select("id,data");
      const { data: ot } = await db.from("office_tasks").select("id,data");
      const office = [...(om || []).map((r) => ({ m: r.data, where: "chat" })), ...(ot || []).flatMap((r) => ((r.data && r.data.messages) || []).map((m) => ({ m, where: `task "${r.data.text}"` })))].filter((x) => unreadTeam(x.m, name)).sort((x, y) => String(x.m.at).localeCompare(String(y.m.at)));
      const [{ data: cm }, { data: cj }, { data: co }] = await Promise.all([db.from("contractor_messages").select("id,data"), db.from("contractor_jobs").select("id,data"), db.from("contractor_orgs").select("id,data")]);
      const jobs = new Map((cj || []).map((r) => [String(r.data && r.data.id), r.data]).filter(([, j]) => j && j.status !== "removed"));
      const orgName = (id) => (((co || []).find((r) => r.data && String(r.data.id) === String(id)) || {}).data || {}).name || "Contractor";
      const ctr = new Map();
      for (const m of (cm || []).map((r) => r.data)) { if (!unreadCtr(m, name) || !jobs.has(String(m.jobId))) continue; const l = ctr.get(String(m.jobId)) || []; l.push(m); ctr.set(String(m.jobId), l); }
      const texts = await unreadTexts(db, me, days);
      const names = texts.length ? await contactNames(db) : new Map();
      const line = (m) => `${first(m.author) || "—"} ${fmtDate(m.at)}: "${String(m.text || (m.attachment ? "[attachment]" : "")).replace(/\s+/g, " ").slice(0, 140)}"`;
      const out = [];
      const nTeam = team.reduce((s, x) => s + x.un.length, 0), nCtr = [...ctr.values()].reduce((s, l) => s + l.length, 0);
      const recent = texts.filter((t) => !t.old), older = texts.filter((t) => t.old);
      out.push(`Unread for ${first(name)}: ${nTeam} in property chats · ${office.length} in the Office Chat · ${nCtr} from contractors · ${texts.reduce((s, t) => s + t.n, 0)} texts in ${texts.length} conversation${texts.length === 1 ? "" : "s"}.`);
      if (team.length) out.push("Property chats:", ...team.map(({ p, un }) => `• ${addrOf(p)} — ${un.length} unread${un.length > 1 ? ` (${fmtDate(un[0].m.at)} – ${fmtDate(un[un.length - 1].m.at)})` : ""}\n   latest ${un[un.length - 1].where !== "chat" ? `in ${un[un.length - 1].where} ` : ""}from ${line(un[un.length - 1].m)}`));
      if (office.length) out.push(`Office Chat — ${office.length} unread, latest from ${line(office[office.length - 1].m)}`);
      if (ctr.size) out.push("Contractors:", ...[...ctr.entries()].map(([jid, l]) => { const j = jobs.get(jid); l.sort((x, y) => String(x.at).localeCompare(String(y.at))); return `• ${orgName(j.orgId)} — ${j.propertyAddress || ""}: ${l.length} unread, latest from ${line(l[l.length - 1])}`; }));
      if (recent.length) out.push("Texts:", ...recent.slice(0, 25).map((t) => `• ${names.get(last10(t.phone)) || t.phone}${names.get(last10(t.phone)) ? ` (${t.phone})` : ""} — ${t.n} unread, latest ${nyWhen(t.last.at)}: "${String(t.last.text || (t.last.media ? "[picture]" : "")).replace(/\s+/g, " ").slice(0, 140)}"`));
      if (older.length) out.push(`(+ ${older.length} older text conversation${older.length === 1 ? "" : "s"} with unread messages from more than ${days} days ago.)`);
      if (!nTeam && !office.length && !nCtr && !texts.length) return `Nothing unread for ${first(name)} — all caught up.`;
      return out.join("\n");
    }
    case "mark_read": {
      const name = me.name;
      const what = a.what || (a.property || a.contractor || a.phone_or_contact ? "" : "all");
      const doTeam = what === "all" || what === "team" || !!a.property;
      const doOffice = what === "all" || what === "office";
      const doCtr = what === "all" || what === "contractors" || !!a.contractor || !!a.property;
      const doTexts = what === "all" || what === "texts" || !!a.phone_or_contact;
      if (!doTeam && !doOffice && !doCtr && !doTexts) fail('What should I mark read? all, team, office, contractors, texts — or a property / contractor / phone.');
      const done = [];
      const addMe = (m, test) => (test(m, name) ? (n++, { ...m, readBy: [...(m.readBy || []), name], readAt: { ...(m.readAt || {}), [name]: new Date().toISOString() } }) : m);
      let n = 0;
      let onlyProp = null;
      if (a.property) onlyProp = findProp(await loadProps(db), a.property).p;
      if (doTeam) {
        n = 0;
        for (const { rowId, p } of await loadProps(db)) {
          if (onlyProp && String(p.id) !== String(onlyProp.id)) continue;
          const hit = (p.messages || []).some((m) => unreadTeam(m, name)) || (p.tasks || []).some((t) => (t.messages || []).some((m) => unreadTeam(m, name)));
          if (!hit) continue;
          await saveProp(db, rowId, (x) => ({ ...x, messages: (x.messages || []).map((m) => addMe(m, unreadTeam)), tasks: (x.tasks || []).map((t) => ((t.messages || []).some((m) => unreadTeam(m, name)) ? { ...t, messages: t.messages.map((m) => addMe(m, unreadTeam)) } : t)) }));
        }
        done.push(`${n} property-chat message${n === 1 ? "" : "s"}${onlyProp ? ` on ${addrOf(onlyProp)}` : ""}`);
      }
      if (doOffice) {
        n = 0;
        const { data: om } = await db.from("office_messages").select("id,data");
        for (const r of om || []) if (unreadTeam(r.data, name)) { n++; await db.from("office_messages").update({ data: { ...r.data, readBy: [...(r.data.readBy || []), name], readAt: { ...(r.data.readAt || {}), [name]: new Date().toISOString() } } }).eq("id", r.id); }
        const { data: ot } = await db.from("office_tasks").select("id,data");
        for (const r of ot || []) { const ms = (r.data && r.data.messages) || []; if (!ms.some((m) => unreadTeam(m, name))) continue; await db.from("office_tasks").update({ data: { ...r.data, messages: ms.map((m) => addMe(m, unreadTeam)) } }).eq("id", r.id); }
        done.push(`${n} Office Chat message${n === 1 ? "" : "s"}`);
      }
      if (doCtr) {
        n = 0;
        const [{ data: cm }, { data: cj }, { data: co }] = await Promise.all([db.from("contractor_messages").select("id,data"), db.from("contractor_jobs").select("id,data"), db.from("contractor_orgs").select("id,data")]);
        let jobIds = null;
        if (a.contractor) { const q = norm(a.contractor); const orgs = (co || []).map((r) => r.data).filter((o) => o && norm(o.name).includes(q)); if (!orgs.length) fail(`No contractor company like "${a.contractor}".`); const ids = new Set(orgs.map((o) => String(o.id))); jobIds = new Set((cj || []).map((r) => r.data).filter((j) => j && ids.has(String(j.orgId))).map((j) => String(j.id))); }
        else if (onlyProp) jobIds = new Set((cj || []).map((r) => r.data).filter((j) => j && (String(j.propertyId) === String(onlyProp.id) || norm(j.propertyAddress).includes(norm(onlyProp.address)))).map((j) => String(j.id)));
        for (const r of cm || []) {
          const m = r.data;
          if (!unreadCtr(m, name) || (jobIds && !jobIds.has(String(m.jobId)))) continue;
          n++; await db.from("contractor_messages").update({ data: { ...m, readBy: [...(m.readBy || []), name], readAt: { ...(m.readAt || {}), [name]: new Date().toISOString() } }, updated_at: nowIso() }).eq("id", r.id);
        }
        done.push(`${n} contractor message${n === 1 ? "" : "s"}`);
      }
      if (doTexts) {
        let phones;
        if (a.phone_or_contact) {
          let ph = String(a.phone_or_contact).trim();
          if (ph.replace(/\D/g, "").length < 10) {
            const { data } = await db.from("contacts").select("data");
            const hits = (data || []).map((r) => r.data).filter((c) => c && norm(c.name).includes(norm(ph)));
            if (hits.length !== 1) fail(hits.length ? `"${ph}" matches ${hits.length} contacts: ${hits.slice(0, 6).map((c) => c.name).join(", ")}.` : `No contact named "${ph}".`);
            phones = [...new Set([...(hits[0].phones || []).map((p) => p.number), hits[0].phone].map((x) => e164(x)).filter(Boolean))];
          } else phones = [e164(ph)].filter(Boolean);
        } else phones = (await unreadTexts(db, me, 0)).map((t) => t.phone);
        const id = `uprefs_${me.id}`;
        const { data: row } = await db.from("app_settings").select("data").eq("id", id).maybeSingle();
        const cur = (row && row.data) || {};
        const stamp = nowIso();
        const smsRead = { ...(cur.smsRead || {}) };
        phones.forEach((p) => { if (String(smsRead[p] || "") < stamp) smsRead[p] = stamp; });
        const { error } = await db.from("app_settings").upsert({ id, data: { ...cur, smsRead }, updated_at: stamp }, { onConflict: "id" });
        if (error) fail(`Couldn't save: ${error.message}`);
        done.push(`${phones.length} text conversation${phones.length === 1 ? "" : "s"}`);
      }
      return `Marked as read: ${done.join(", ")}. The unread badges clear in the app (a device that's already open catches up within a moment or on its next refresh).`;
    }
    case "rentals_overview": {
      const ym = ymOf(a.month) || ymNow();
      const { recs, list, ctx, live } = await rentalsCtx(db);
      if (!recs.length) return "No rentals yet.";
      const dq = delinquency(list, ctx);
      const owed = new Map(dq.props.map((x) => [String(x.r.id), x.owed]));
      let tin = 0, tout = 0, tcf = 0, troll = 0;
      const lines = recs.map(({ r }) => {
        const pl = rentalMonthPL(r, ym, ctx);
        const roll = (r.units || []).reduce((s, u) => s + num(u.rent), 0);
        tin += pl.totalIn; tout += pl.totalOut; tcf += pl.cashFlow; troll += roll;
        const st = rentStatus(live, ctx.keyFor(r));
        const ow = owed.get(String(r.id)) || 0;
        return `• ${r.address}${r.city ? `, ${r.city}` : ""} — ${(r.units || []).length} unit${(r.units || []).length === 1 ? "" : "s"}, rent roll ${$(roll)}/mo\n   ${mLabel(ym)}: in ${$(pl.totalIn)} · expenses ${$(pl.totalOut)} · net ${$(pl.net)} · after mortgage ${$(pl.cashFlow)}${st ? `\n   Platinum: ${st}` : ""}${ow > 0.5 ? `\n   Tenants owe ${$(ow)}` : ow < -0.5 ? `\n   Paid ahead ${$(-ow)}` : ""}`;
      });
      return `Rental portfolio — ${mLabel(ym)} (${recs.length} rentals, rent roll ${$(troll)}/mo):\nMoney in ${$(tin)} · expenses ${$(tout)} · net ${$(tin - tout)} · after mortgage ${$(tcf)} · tenants owe ${$(dq.total)}\n${lines.join("\n")}`;
    }
    case "rental_details": {
      const ym = ymOf(a.month) || ymNow();
      const { recs, list, ctx, live } = await rentalsCtx(db);
      const { r } = findRental(recs, a.rental);
      const pl = rentalMonthPL(r, ym, ctx);
      const key = ctx.keyFor(r);
      const dq = delinquency(list, ctx).props.find((x) => String(x.r.id) === String(r.id));
      const mg = r.mortgage || {};
      const out = [`${r.address}${r.city ? `, ${r.city}` : ""} — ${(r.units || []).length} unit${(r.units || []).length === 1 ? "" : "s"}${key ? " · managed by Platinum" : ""}`];
      out.push("Units:", ...((r.units || []).length ? r.units.map((u) => `• ${u.label || "Unit"}: ${u.tenant && u.tenant.name ? u.tenant.name : "no tenant"} — rent ${$(num(u.rent))}${u.leaseStart || u.leaseEnd ? ` · lease ${u.leaseStart || "?"} → ${u.leaseEnd || "?"}` : ""}${u.tenant && u.tenant.phone ? ` · ${u.tenant.phone}` : ""}${u.tenant && u.tenant.email ? ` · ${u.tenant.email}` : ""}`) : ["• none"]));
      if (mg.payment || mg.lender) out.push(`Mortgage: ${mg.lender || "—"}${mg.payment ? ` · ${$(num(mg.payment))}/mo` : ""}${mg.rate ? ` · ${mg.rate}%` : ""}${mg.amount ? ` · loan ${$(num(mg.amount))}` : ""}`);
      out.push(`${mLabel(ym)}: in ${$(pl.totalIn)} · expenses ${$(pl.totalOut)} · net ${$(pl.net)} · mortgage ${$(pl.mortgage)} · after mortgage ${$(pl.cashFlow)}`);
      if (pl.income.length) out.push(`   Income: ${pl.income.map((x) => `${x.cat} ${$(x.amount)}`).join(", ")}`);
      if (pl.expenses.length) out.push(`   Expenses: ${pl.expenses.map((x) => `${x.cat} ${$(x.amount)}`).join(", ")}`);
      const st = rentStatus(live, key); if (st) out.push(`Platinum: ${st}`);
      if (live && key) {
        const tx = live.txns.filter((t) => t.key === key).sort((x, y) => String(y.date).localeCompare(String(x.date))).slice(0, 10);
        if (tx.length) out.push("Recent Platinum lines:", ...tx.map((t) => `• ${t.date} ${t.dir === "in" ? "+" : "−"}${$(t.amount)} ${t.unit ? `${t.unit} ` : ""}${t.desc || t.payee || ""}${(r.txMonths || {})[t.id] ? " (moved)" : ""}`));
      }
      if (dq) out.push(`Tenants: ${dq.tenants.map((t) => `${t.name || t.label}${t.vacant ? " (vacant)" : ""}: ${t.owed > 0.5 ? `owes ${$(t.owed)}` : t.owed < -0.5 ? `paid ahead ${$(-t.owed)}` : "paid up"}`).join(" · ")}`);
      return out.join("\n");
    }
    case "delinquency_report": {
      const asOf = ymdOf(a.as_of, "date") || todayIso();
      const { recs, list, ctx } = await rentalsCtx(db);
      const only = a.rental ? findRental(recs, a.rental).r : null;
      const d = delinquency(list, ctx, asOf);
      const props = d.props.filter((x) => !only || String(x.r.id) === String(only.id));
      const rows = props.flatMap((x) => x.tenants.filter((t) => !t.vacant && (a.include_paid || t.owed > 0.5)).map((t) => ({ x, t })));
      const total = props.reduce((s, x) => s + Math.max(0, x.owed), 0);
      const head = `Delinquency as of ${asOf}${only ? ` — ${only.address}` : ""}: ${$(total)} owed${only ? "" : ` · ${d.behind.length} of ${Array.isArray(d.occupied) ? d.occupied.length : d.occupied} occupied units behind · aging 0-30 ${$(d.aging[0])} / 31-60 ${$(d.aging[1])} / 61-90 ${$(d.aging[2])} / 90+ ${$(d.aging[3])}`}`;
      if (!rows.length) return `${head}\nNobody is behind.`;
      rows.sort((p, q) => q.t.owed - p.t.owed);
      return `${head}\n` + rows.map(({ x, t }) => `• ${t.name || "Tenant"} — ${x.r.address}${t.label && t.label !== x.r.address ? ` ${t.label}` : ""}: ${t.owed > 0.5 ? `owes ${$(t.owed)}` : t.owed < -0.5 ? `paid ahead ${$(-t.owed)}` : "paid up"}${t.owed > 0.5 ? ` (0-30 ${$(t.aging[0])}, 31-60 ${$(t.aging[1])}, 61-90 ${$(t.aging[2])}, 90+ ${$(t.aging[3])})` : ""}${t.last ? ` · last paid ${$(t.last.amount)} on ${t.last.date}` : ""}${t.marked ? " · marked" : ""}`).join("\n");
    }
    case "update_rental": {
      const { recs } = await rentalsCtx(db);
      const { rowId, r } = findRental(recs, a.rental);
      const changes = [];
      if (a.add_unit) {
        const label = String(a.add_unit).trim();
        await saveRental(db, rowId, (x) => ({ ...x, units: [...(x.units || []), { id: Date.now(), label, rent: "", leaseStart: "", leaseEnd: "", tenant: { name: "", phone: "", email: "" } }] }));
        changes.push(`added unit ${label}`);
      }
      const unitEdits = Object.keys({ ...UNIT_FIELDS, ...TENANT_FIELDS }).filter((k) => a[k] !== undefined);
      if (unitEdits.length || a.remove_unit) {
        const fresh = a.add_unit ? findRental((await rentalsCtx(db)).recs, a.rental).r : r;
        const u = pickUnit(fresh, a.unit);
        if (a.remove_unit) {
          if (a.confirmed !== true) fail(`Not removed. Confirm with the user: remove unit ${u.label || ""}${u.tenant && u.tenant.name ? ` (${u.tenant.name})` : ""} from ${r.address}? Then call again with confirmed=true.`);
          await saveRental(db, rowId, (x) => ({ ...x, units: (x.units || []).filter((y) => String(y.id) !== String(u.id)) }));
          changes.push(`removed unit ${u.label || ""}`);
        } else {
          const patch = {}, tpatch = {};
          for (const [k, [key, l, t]] of Object.entries(UNIT_FIELDS)) if (a[k] !== undefined) { patch[key] = t === "date" ? ymdOf(a[k], l) : key === "rent" ? String(a[k]).replace(/[^\d.]/g, "") : String(a[k]).trim(); changes.push(`${l} → ${patch[key] || "(cleared)"}`); }
          for (const [k, [key, l]] of Object.entries(TENANT_FIELDS)) if (a[k] !== undefined) { tpatch[key] = String(a[k]).trim(); changes.push(`${l} → ${tpatch[key] || "(cleared)"}`); }
          await saveRental(db, rowId, (x) => ({ ...x, units: (x.units || []).map((y) => (String(y.id) !== String(u.id) ? y : { ...y, ...patch, ...(Object.keys(tpatch).length ? { tenant: { ...(y.tenant || {}), ...tpatch } } : {}) })) }));
        }
      }
      const mg = Object.entries(MORTGAGE_FIELDS).filter(([k]) => a[k] !== undefined);
      if (mg.length) {
        const patch = {};
        for (const [k, [key, l]] of mg) { patch[key] = key === "lender" ? String(a[k]).trim() : String(a[k]).replace(/[^\d.]/g, ""); changes.push(`${l} → ${patch[key] || "(cleared)"}`); }
        await saveRental(db, rowId, (x) => ({ ...x, mortgage: { ...(x.mortgage || {}), ...patch } }));
      }
      if (!changes.length) return "Nothing to change — say what to update.";
      return `${r.address}: ${changes.join("; ")}.`;
    }
    case "mark_tenant": {
      const { recs, list, ctx } = await rentalsCtx(db);
      const { rowId, r } = findRental(recs, a.rental);
      const dq = delinquency(list, ctx).props.find((x) => String(x.r.id) === String(r.id));
      const ts = dq ? dq.tenants : [];
      let t = null;
      if (ts.length === 1) t = ts[0];
      else {
        const q = norm(a.unit);
        if (!q) fail(`${r.address} has ${ts.length} tenants: ${ts.map((x) => `${x.label || "?"}${x.name ? ` (${x.name})` : ""}`).join(", ")}. Which one?`);
        const hits = ts.filter((x) => norm(x.label) === q || norm(x.label).replace(/^(unit|apt) ?#?/, "") === q.replace(/^(unit|apt) ?#?/, "") || (x.name && norm(x.name).includes(q)) || String(x.key) === q);
        if (hits.length !== 1) fail(`No single tenant matches "${a.unit}". Tenants: ${ts.map((x) => `${x.label || "?"}${x.name ? ` (${x.name})` : ""}`).join(", ")}.`);
        t = hits[0];
      }
      const k = (t && t.key) || "_";
      let val = null;
      if (a.mark === "vacant") val = { vacant: true };
      else if (a.mark === "new_tenant") { const ym = ymOf(a.from_month); if (!ym) fail("From which month did the new tenant move in?"); val = { startYm: ym }; }
      await saveRental(db, rowId, (x) => { const marks = { ...(x.dqMarks || {}) }; if (val) marks[k] = { ...val, at: nowIso() }; else delete marks[k]; return { ...x, dqMarks: marks }; });
      const who = `${t && t.name ? t.name : "the tenant"}${t && t.label ? ` (${t.label})` : ""} at ${r.address}`;
      return a.mark === "vacant" ? `Marked ${who} vacant — balance wiped, not counted in the report.` : a.mark === "new_tenant" ? `Marked a new tenant for ${who} from ${mLabel(val.startYm)} — their ledger starts fresh that month.` : `Cleared the mark on ${who}.`;
    }
    case "move_rental_payment": {
      const { recs, ctx, live } = await rentalsCtx(db);
      const { rowId, r } = findRental(recs, a.rental);
      const key = ctx.keyFor(r);
      if (!live || !key) fail(`${r.address} isn't linked to Platinum, so there are no Platinum payments to move.`);
      const q = String(a.payment || "").trim();
      const amt = (q.match(/\d[\d,]*\.?\d*/g) || []).map((x) => num(x)).filter((x) => x >= 10);
      const words = norm(q.replace(/\$?\d[\d,]*\.?\d*/g, " ")).split(" ").filter((w) => w.length > 2);
      const cand = live.txns.filter((t) => t.key === key && !isReversal(t));
      const score = (t) => { const hay = norm(`${t.desc} ${t.payee || ""} ${t.unit || ""} ${t.date} ${new Date(`${t.date}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" })}`); return (amt.some((v) => Math.abs(v - t.amount) < 0.01) ? 2 : 0) + words.filter((w) => hay.includes(w)).length; };
      const ranked = cand.map((t) => ({ t, s: score(t) })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s || String(y.t.date).localeCompare(String(x.t.date)));
      if (!ranked.length) fail(`No Platinum payment on ${r.address} matches "${q}".`);
      const top = ranked.filter((x) => x.s === ranked[0].s);
      if (top.length > 1) fail(`That matches ${top.length} payments: ${top.slice(0, 8).map((x) => `${x.t.date} ${$(x.t.amount)} ${x.t.unit || ""} ${x.t.desc || ""}`).join(" | ")}. Be more specific (date + amount).`);
      const t = top[0].t;
      let v = null, said = "";
      if (a.automatic) said = "back to automatic (the month written on it)";
      else if (Array.isArray(a.split) && a.split.length) {
        const parts = a.split.map((x) => ({ ym: ymOf(x.month), amount: Math.round(num(x.amount) * 100) / 100 }));
        const sum = parts.reduce((s, x) => s + x.amount, 0);
        if (Math.abs(sum - Math.abs(t.amount)) > 0.01) fail(`The split adds up to ${$(sum)} but the payment is ${$(t.amount)} — the pieces must add up exactly.`);
        v = { split: parts }; said = `split: ${parts.map((x) => `${mLabel(x.ym)} ${$(x.amount)}`).join(", ")}`;
      } else {
        const ym = ymOf(a.to_month);
        if (!ym) fail("Which month should it count toward (to_month), or give a split?");
        v = { ym }; said = `counts toward ${mLabel(ym)}`;
      }
      await saveRental(db, rowId, (x) => { const m = { ...(x.txMonths || {}) }; if (v) m[t.id] = v; else delete m[t.id]; return { ...x, txMonths: m }; });
      return `${r.address}: the ${t.date} payment of ${$(t.amount)}${t.unit ? ` (${t.unit})` : ""} — ${t.desc || ""} — now ${said}. The entry date doesn't change.`;
    }
    case "reverse_listings": {
      adminOnly(me, "check reverse prospecting");
      const rows = await loadProps(db);
      const { data: srow } = await db.from("app_settings").select("data").eq("id", "mls_sources").maybeSingle();
      const mlsList = ((srow && srow.data && srow.data.items) || []);
      const list = rows.filter((r) => r.p.status === "On Market" || (r.p.mlsSource && !/sold|closed/i.test(String(r.p.status || ""))));
      if (!list.length) return "No listings are On Market right now (and none has an MLS set).";
      const out = [`MLS accounts (log in through the teammate's own Chrome — never ask for or type passwords):`, ...(mlsList.length ? mlsList.map((m) => `• ${m.name}${m.url ? ` — ${m.url}` : ""}${m.notes ? ` — ${m.notes}` : ""}`) : ["• none saved yet (the teammate adds them in Showings → a listing → 🎯 Reverse → 🔑 MLS)"]), ""];
      list.forEach(({ p }) => {
        const m = mlsList.find((x) => String(x.id) === String(p.mlsSource || ""));
        const ag = p.rpAgents || [];
        const cellOf = (x) => ("cell" in x ? x.cell : "");
        out.push(`🏠 ${addrOf(p)} — ${p.status || ""}${m ? ` · MLS: ${m.name}${m.url ? ` (${m.url})` : ""}` : " · MLS: not set"}${p.mlsNumber ? ` · MLS #${p.mlsNumber}` : ""}${p.rpCheckedAt ? ` · last checked ${fmtDate(p.rpCheckedAt)}` : " · never checked"}`);
        if (ag.length) out.push(`   Already have ${ag.length}: ${ag.map((x) => `${x.name || "?"}${cellOf(x) ? " (cell ✓)" : " (NEEDS CELL)"}${x.email ? ` <${x.email}>` : ""}`).join("; ")}`);
        else out.push("   No agents yet.");
      });
      return out.join("\n");
    }
    case "add_reverse_agents": {
      adminOnly(me, "add reverse-prospecting agents");
      const L = Array.isArray(a.listings) ? a.listings : [];
      if (!L.length) fail("Which listings? Send listings: [{property, agents:[…]}].");
      const rows = await loadProps(db);
      const dg = (v) => { const d = String(v || "").replace(/\D/g, ""); return d.length === 11 && d[0] === "1" ? d.slice(1) : d; };
      const fp = (v) => { const d = dg(v); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : ""; };
      const nk = (n) => String(n || "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
      const ek = (e) => String(e || "").toLowerCase().trim();
      const now = nowIso();
      const lines = [], pushParts = [];
      let firstId = null;
      for (const item of L) {
        const { rowId, p } = findProp(rows, item.property);
        const incoming = (Array.isArray(item.agents) ? item.agents : []).filter((x) => x && String(x.name || "").trim()).slice(0, 200);
        // A number shared by two different agents, or equal to the office line, is an office number.
        const seen = new Map(), shared = new Set();
        incoming.forEach((x) => { const d = dg(x.cell); if (d.length === 10) { const n = nk(x.name); if (seen.has(d) && seen.get(d) !== n) shared.add(d); else seen.set(d, n); } });
        let added = 0, cells = 0;
        const next = await saveProp(db, rowId, (cur) => {
          const list = [...(cur.rpAgents || [])];
          incoming.forEach((x, i) => {
            const c = dg(x.cell);
            const cell = c.length === 10 && !shared.has(c) && c !== dg(x.office_phone) ? fp(c) : "";
            const office = fp(x.office_phone) || (c.length === 10 && !cell ? fp(c) : "");
            const k = list.findIndex((y) => (cell && dg(y.cell) === dg(cell)) || (x.email && ek(y.email) === ek(x.email)) || (nk(y.name) && nk(y.name) === nk(x.name)));
            if (k >= 0) {
              const y = list[k];
              const hadCell = "cell" in y && dg(y.cell).length === 10;
              const upd = { ...y, ...("cell" in y ? {} : { officePhone: y.officePhone || y.phone || "" }), email: y.email || String(x.email || "").trim(), office: y.office || String(x.office || "").trim(), buyers: Math.max(y.buyers || 1, Number(x.buyers) || 1), officePhone: (y.officePhone || ("cell" in y ? "" : y.phone) || office || "") };
              if (!hadCell && cell) { upd.cell = cell; upd.cellFrom = "MLS business card"; cells++; } else if (!("cell" in y)) upd.cell = "";
              list[k] = upd;
            } else {
              list.push({ id: `rp${Date.now()}${i}`, name: String(x.name).trim().slice(0, 80), cell, cellFrom: cell ? "MLS business card" : "", officePhone: office, email: String(x.email || "").trim().slice(0, 120), office: String(x.office || "").trim().slice(0, 80), buyers: Math.max(1, Math.min(99, Number(x.buyers) || 1)), note: String(x.note || "").trim().slice(0, 160), addedAt: now, addedBy: me.name, source: "cowork" });
              added++;
            }
          });
          return { ...cur, rpAgents: list, rpCheckedAt: now, ...(item.mls_number && !cur.mlsNumber ? { mlsNumber: String(item.mls_number).trim().slice(0, 40) } : {}) };
        });
        const needCell = (next.rpAgents || []).filter((y) => !("cell" in y) || dg(y.cell).length !== 10).length;
        lines.push(`${addrOf(p)}: ${added} new agent${added === 1 ? "" : "s"}${cells ? `, ${cells} cell${cells === 1 ? "" : "s"} filled in` : ""} · ${(next.rpAgents || []).length} total${needCell ? ` · ${needCell} still need a cell` : ""}`);
        if (added || cells) { pushParts.push(`${String(addrOf(p)).split(",")[0]}: ${added ? `+${added} agent${added === 1 ? "" : "s"}` : ""}${added && cells ? ", " : ""}${cells ? `${cells} cell${cells === 1 ? "" : "s"}` : ""}`); if (firstId == null) firstId = p.id; }
      }
      if (pushParts.length && a.notify !== false) {
        try { await notifyFanout(db, me.id, { toSelf: true, title: "🎯 New reverse-prospecting agents", body: `${pushParts.join(" · ")} — ready to text`, url: `/?goto=reverse:${firstId}`, tag: "reverse-prospecting" }); } catch { /* best effort */ }
      }
      return `${lines.join("\n")}${pushParts.length ? (a.notify !== false ? "\nPush sent." : "") : "\nNothing new — no push sent."} Nothing was texted.`;
    }
    default:
      fail(`Unknown tool: ${name}`);
  }
  return "";
}
