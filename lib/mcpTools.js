// 🤖 Claude connector — the actions (MCP tools) a teammate can run by talking
// to Claude (Elie 10/13/26). Everything runs AS the signed-in teammate: tasks
// show them as creator, texts go out from their own line, notifications name them.
// Data lives where the app keeps it: properties.data (tasks, messages),
// office_tasks (Company tasks), contacts, users. Writes are read-modify-write
// of one row; the app's realtime sync + three-way merge picks them up.
import { admin } from "./mcpAuth.js";
import { notifyFanout } from "./notify.js";
import { storeSms, e164, firstName, sameFirst, checkOutreach, resolveSender, optedOut } from "./jivetel.js";
import { fetchShowings } from "./showings.js";
import { graph, uploadToFolder, textToHtml, htmlToText } from "./msGraph.js";
import { readFileContent } from "./fileRead.js";
import { resolveCallPerson, click2call } from "./jivetelCall.js";
import { parseWhen, loadTexts, ownLine, linesFor, readMapFor, savedNames, nyStamp, prettyPhone, last10 } from "./textsQuery.js";

const OFFICE = "__office_task__";
const isDone = (t) => t && (t.status === "Completed" || t.status === "N/A");
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const addrOf = (p) => `${p.address || "Property"}${p.city ? `, ${p.city}` : ""}`;
const nowIso = () => new Date().toISOString();
const newId = () => Date.now() + Math.floor(Math.random() * 1000);
const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }); } catch { return ""; } };
const first = (n) => String(n || "").split(" ")[0];
const COMPANY = ["company", "office", "company tasks", "company task", "general", "office chat", "general chat", "general thread", "team chat", "office thread"];

class UserError extends Error {}
const fail = (msg) => { throw new UserError(msg); };

// ── Loading ──────────────────────────────────────────────────────────────────
async function loadProps(db) {
  const { data, error } = await db.from("properties").select("id,data");
  if (error) fail(`Couldn't load properties: ${error.message}`);
  return (data || []).filter((r) => r && r.data && !r.data.archived && !r.data.deleted).map((r) => ({ rowId: r.id, p: r.data }));
}
async function loadOffice(db) {
  const { data } = await db.from("office_tasks").select("id,data");
  return (data || []).filter((r) => r && r.data && !r.data.deleted).map((r) => ({ rowId: r.id, t: r.data }));
}
async function loadTeam(db) {
  const { data } = await db.from("users").select("id,name,email,role");
  return (data || []).filter((u) => u.role !== "contractor" && u.name).map((u) => ({ id: u.id, name: u.name }));
}

function findProp(rows, q) {
  const s = String(q || "").trim();
  if (!s) fail("Which property? Give part of the address.");
  const byId = rows.find((r) => String(r.p.id) === s || String(r.rowId) === s);
  if (byId) return byId;
  const nq = norm(s), toks = nq.split(" ").filter(Boolean);
  let hits = rows.filter((r) => norm(addrOf(r.p)).includes(nq));
  if (!hits.length) hits = rows.filter((r) => { const a = norm(`${addrOf(r.p)} ${r.p.state || ""} ${r.p.zip || ""}`); return toks.every((t) => a.includes(t)); });
  if (!hits.length) fail(`No property matches "${s}".`);
  if (hits.length > 1) {
    const exact = hits.filter((r) => norm(r.p.address).startsWith(nq));
    if (exact.length === 1) return exact[0];
    fail(`"${s}" matches ${hits.length} properties: ${hits.slice(0, 8).map((r) => addrOf(r.p)).join(" | ")}. Be more specific.`);
  }
  return hits[0];
}
function findTask(tasks, q, label) {
  const s = String(q || "").trim();
  if (!s) fail("Which task?");
  const id = s.replace(/^#/, "");
  const byId = tasks.find((t) => String(t.id) === id);
  if (byId) return byId;
  const nq = norm(s);
  let hits = tasks.filter((t) => norm(t.text).includes(nq));
  if (hits.length > 1) { const open = hits.filter((t) => !isDone(t)); if (open.length) hits = open; }
  if (hits.length > 1) { const ex = hits.filter((t) => norm(t.text) === nq); if (ex.length === 1) hits = ex; }
  if (!hits.length) fail(`No task matching "${s}" on ${label}.`);
  if (hits.length > 1) fail(`"${s}" matches ${hits.length} tasks on ${label}: ${hits.slice(0, 8).map((t) => `#${t.id} ${t.text}`).join(" | ")}. Use the #id.`);
  return hits[0];
}
function resolvePerson(team, me, name) {
  const s = String(name || "").trim();
  if (!s) return "";
  if (/^(me|myself|i)$/i.test(s)) return me.name;
  const hit = team.find((u) => u.name.toLowerCase() === s.toLowerCase()) || team.find((u) => sameFirst(u.name, s)) || team.find((u) => u.name.toLowerCase().includes(s.toLowerCase()));
  if (!hit) fail(`No teammate named "${s}". Team: ${team.map((u) => u.name).join(", ")}.`);
  return hit.name;
}

// ── Saving ───────────────────────────────────────────────────────────────────
async function saveProp(db, rowId, fn) {
  const { data: row, error } = await db.from("properties").select("data").eq("id", rowId).maybeSingle();
  if (error || !row) fail("Couldn't load that property to save.");
  const next = fn(row.data);
  const { error: e2 } = await db.from("properties").update({ data: next }).eq("id", rowId);
  if (e2) fail(`Couldn't save: ${e2.message}`);
  return next;
}
async function saveOffice(db, rowId, fn) {
  const { data: row } = await db.from("office_tasks").select("data").eq("id", rowId).maybeSingle();
  if (!row) fail("Couldn't load that company task.");
  const next = fn(row.data);
  const { error } = await db.from("office_tasks").update({ data: next }).eq("id", rowId);
  if (error) fail(`Couldn't save: ${error.message}`);
  return next;
}
// Where a task lives → {label, tasks, update(fn on task), pid}
async function locate(db, property) {
  if (COMPANY.includes(norm(property))) {
    const rows = await loadOffice(db);
    return {
      pid: OFFICE, label: "Company tasks", tasks: rows.map((r) => r.t),
      update: async (taskId, fn) => { const r = rows.find((x) => String(x.t.id) === String(taskId)); if (!r) fail("Task not found."); return saveOffice(db, r.rowId, fn); },
      add: async (task) => { const { error } = await db.from("office_tasks").insert({ id: String(task.id), data: task }); if (error) fail(`Couldn't save: ${error.message}`); },
    };
  }
  const props = await loadProps(db);
  const r = findProp(props, property);
  return {
    pid: r.p.id, label: addrOf(r.p), prop: r.p, tasks: (r.p.tasks || []).filter((t) => t && !t.deleted),
    update: async (taskId, fn) => { let out = null; await saveProp(db, r.rowId, (p) => ({ ...p, tasks: (p.tasks || []).map((t) => (String(t.id) === String(taskId) ? (out = fn(t)) : t)) })); if (!out) fail("Task not found."); return out; },
    add: async (task) => saveProp(db, r.rowId, (p) => ({ ...p, tasks: [...(p.tasks || []), task] })),
    addMsg: async (msg) => saveProp(db, r.rowId, (p) => ({ ...p, messages: [...(p.messages || []), msg] })),
  };
}
const subsOf = (t) => (Array.isArray(t.subtasks) ? t.subtasks.filter((s) => s && s.text) : []);
function withSubs(t, subs, me) {
  const total = subs.length, done = subs.filter((x) => x.done).length;
  if (total && done === total && !isDone(t)) return { ...t, subtasks: subs, status: "Completed", completedAt: nowIso(), completedBy: me, subAutoDone: true };
  if (done < total && t.status === "Completed" && t.subAutoDone) return { ...t, subtasks: subs, status: "Not Started", completedAt: null, completedBy: null, subAutoDone: false };
  return { ...t, subtasks: subs };
}
const taskLine = (t) => {
  const s = subsOf(t), d = s.filter((x) => x.done).length;
  const who = t.assignee ? (t.delegate ? `${first(t.assignee)} → ${first(t.delegate)}` : first(t.assignee)) : "unassigned";
  return `#${t.id} ${t.urgent && !isDone(t) ? "🚨 " : ""}${t.text}${s.length ? ` (${d}/${s.length})` : ""} — ${who}${isDone(t) ? ` · done${t.completedAt ? " " + fmtDate(t.completedAt) : ""}` : ""}`;
};
const goto = (pid, tid) => `/?goto=task:${pid === OFFICE ? "office" : pid}:${tid}`;
async function ping(db, me, names, opts) {
  const list = [...new Set((names || []).filter((n) => n && n !== me.name))];
  if (!list.length) return;
  try { await notifyFanout(db, me.id, { recipients: list, ...opts }); } catch { /* best effort */ }
}

// ── Showings + texts helpers ─────────────────────────────────────────────────
// Same address matcher the app uses (showingMatchesProperty in GoldstoneApp.jsx).
const QB_STOP = new Set(["st","street","ave","avenue","rd","road","dr","drive","ln","lane","ct","court","blvd","boulevard","pl","place","ter","terrace","way","cir","circle","hwy","highway","pkwy","parkway","sq","square","trl","trail","apt","unit","ste","suite","fl","floor","n","s","e","w","north","south","east","west"]);
const qbNorm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const qbHouseNum = (s) => { const m = qbNorm(s).match(/\b(\d+[a-z]?)\b/); return m ? m[1] : null; };
const qbStreetWords = (s) => qbNorm(s).split(" ").filter(Boolean).filter((t) => !/^\d+$/.test(t) && !QB_STOP.has(t));
// "24 A Dewey Drive" (ShowingTime) = our "24A Dewey Dr": digits match, unit letters agree or one side has none.
const sameHouseNum = (x, y) => { if (!x || !y) return false; const mx = x.match(/^(\d+)([a-z]?)$/), my = y.match(/^(\d+)([a-z]?)$/); if (!mx || !my) return x === y; return mx[1] === my[1] && (!mx[2] || !my[2] || mx[2] === my[2]); };
function showingMatchesProperty(text, p) {
  const a = `${p.address || ""} ${p.city || ""}`;
  const hn = qbHouseNum(a), thn = qbHouseNum(text || "");
  if (!sameHouseNum(hn, thn)) return false;
  const words = new Set(qbStreetWords(a));
  return qbStreetWords(text || "").some((w) => words.has(w));
}
const NY = "America/New_York";
const nyDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: NY, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
// Floating "2026-10-14T17:20:00" (New York wall clock) → epoch ms.
function nyLocalToMs(local) {
  const m = String(local || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return NaN;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: NY, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const asNy = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return guess - (asNy - guess);
}
const showStartMs = (s) => (/Z$|[+-]\d{2}:?\d{2}$/.test(String(s.start || "")) ? Date.parse(s.start) : nyLocalToMs(s.start));
const showNyDate = (s) => (String(s.start || "").length <= 10 ? String(s.start) : /Z$|[+-]\d{2}:?\d{2}$/.test(String(s.start)) ? nyDate(new Date(s.start)) : String(s.start).slice(0, 10));
const nyTime = (ms) => new Date(ms).toLocaleTimeString("en-US", { timeZone: NY, hour: "numeric", minute: "2-digit" });
const nyWhen = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: NY, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
function parseDay(v) {
  const s = String(v || "today").trim().toLowerCase();
  const t = new Date();
  if (s === "today" || !s) return nyDate(t);
  if (s === "tomorrow") return nyDate(new Date(t.getTime() + 86400000));
  if (s === "yesterday") return nyDate(new Date(t.getTime() - 86400000));
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(v); if (!isNaN(d)) return nyDate(d);
  fail(`I couldn't read the date "${v}". Use today, tomorrow, or YYYY-MM-DD.`);
}
const phoneKeys = (ph) => { const e = e164(ph); if (!e) return []; const d10 = e.replace(/\D/g, "").slice(-10); return [e, e.replace(/^\+/, ""), d10]; };
// Text rows for these numbers (newest first). Non-admins only see threads they took part in.
async function smsFor(db, phones, me) {
  const keys = [...new Set(phones.flatMap(phoneKeys))];
  if (!keys.length) return [];
  const { data } = await db.from("sms_messages").select("phone,data").in("phone", keys);
  let rows = (data || []).map((r) => ({ ...(r.data || {}), phone: e164(r.phone || (r.data || {}).phone) })).filter((x) => x.at);
  if (me.role === "contractor") {
    const mine = new Set(rows.filter((x) => String(x.direction).startsWith("out") && sameFirst(x.by, me.name)).map((x) => x.phone));
    rows = rows.filter((x) => mine.has(x.phone));
  }
  return rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// A contact's best texting number (mobile/cell first).
async function contactPhone(db, name) {
  const q = norm(name);
  const { data } = await db.from("contacts").select("data");
  const hits = (data || []).map((r) => r.data).filter((c) => c && norm(c.name).includes(q));
  if (!hits.length) fail(`No contact named "${name}". Give a phone number instead.`);
  const exact = hits.filter((c) => norm(c.name) === q);
  if (hits.length > 1 && exact.length !== 1) fail(`"${name}" matches ${hits.length} contacts: ${hits.slice(0, 6).map((c) => c.name).join(", ")}. Be more specific.`);
  const c = exact.length === 1 ? exact[0] : hits[0];
  const num = ((c.phones || []).find((p) => /mobile|cell/i.test(p.label || "")) || (c.phones || [])[0] || {}).number || c.phone;
  if (!num) fail(`${c.name} has no phone number on file.`);
  return { num, name: c.name };
}
// Send one SMS from the signed-in teammate's OWN line (never anyone else's).
// Callers must have the user's explicit OK first.
export async function sendSmsAs(db, me, toRaw, messageRaw, property) {
  const message = String(messageRaw || "").trim();
  if (!message) fail("The message is empty.");
  let to = String(toRaw || "").trim(), toName = "";
  if (to.replace(/\D/g, "").length < 10) { const c = await contactPhone(db, to); to = c.num; toName = c.name; }
  const user = { id: me.id, email: me.email, user_metadata: { name: me.name } };
  const { person, from, token } = resolveSender(user, null, me.name);
  if (!from || !token) fail(`Texting isn't connected for ${person || me.name} yet.`);
  if (await optedOut(to)) fail(`${toName || to} asked not to be texted — they're on the do-not-text list.`);
  const gate = await checkOutreach(to, me.name, "text");
  if (!gate.allowed) fail(`This is ${first(gate.owner)}'s contact — ${first(gate.owner)} got an approval request. Once approved you can text them.`);
  const body = { to: e164(to), from: e164(from), message };
  if (!body.to) fail(`"${toRaw}" isn't a phone number I can text.`);
  const r = await fetch("https://jivetel-txt.jivetel.com/api/send", { method: "POST", headers: { "Content-Type": "application/json", Authorization: token.includes(" ") ? token : `Bearer ${token}` }, body: JSON.stringify(body) });
  const txt = await r.text();
  if (!r.ok) fail(`The text didn't go through (Jivetel ${r.status}).`);
  let d = null; try { d = JSON.parse(txt); } catch { /* ok */ }
  if (d && d.status === false) fail(d.msg || "Jivetel rejected the message.");
  await storeSms({ id: String(d?.id || `out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`), phone: body.to, direction: "out", text: message, by: me.name, from: body.from, at: nowIso(), status: "sent", via: "claude", ...(property ? { prop: String(property).slice(0, 80) } : {}) }).catch(() => {});
  return { person: person || me.name, to: body.to, toName, message };
}

// ── Outlook + OneDrive helpers (the connected teammate's OWN mailbox only) ───
export const STORAGE_PUBLIC = `${process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co"}/storage/v1/object/public/attachments/`;
const mbox = (me) => { if (!me.email || !/@/.test(me.email)) fail("Your Goldstone login has no email address on file."); return encodeURIComponent(me.email); };
async function msCall(fn) {
  try { return await fn(); } catch (e) {
    if (e instanceof UserError) throw e;
    if (e.setup) fail(`Email/files aren't switched on yet: ${e.message}`);
    if (e.permission) fail(`Microsoft hasn't given the Goldstone app permission for this yet (Microsoft said: ${String(e.message || "").slice(0, 200)}). Elie needs to approve it in Microsoft (Azure → App registrations → API permissions → Mail.Send, Mail.ReadWrite, Files.ReadWrite.All → Grant admin consent).`);
    if (e.status === 404) fail("Not found in Microsoft — the email or file may have moved, or this login's email isn't a Goldstone Microsoft mailbox.");
    fail(`Microsoft error: ${e.message}`);
  }
}
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`);
// Names → email addresses (team first, then contacts). Raw addresses pass through.
async function resolveEmails(db, list) {
  const items = (Array.isArray(list) ? list : list ? [list] : []).flatMap((x) => String(x || "").split(/[;,]/)).map((x) => x.trim()).filter(Boolean);
  if (!items.length) return [];
  const { data: users } = await db.from("users").select("name,email,role");
  const team = (users || []).filter((u) => u.role !== "contractor" && u.email);
  const { data: crow } = await db.from("contacts").select("data");
  const contacts = (crow || []).map((r) => r.data).filter((c) => c && c.email);
  return items.map((x) => {
    const m = x.match(/[^\s<>"]+@[^\s<>"]+\.[^\s<>"]+/);
    if (m) return { address: m[0], name: x.replace(m[0], "").replace(/[<>"]/g, "").trim() || undefined };
    const t = team.filter((u) => sameFirst(u.name, x) || norm(u.name) === norm(x));
    if (t.length === 1) return { address: t[0].email, name: t[0].name };
    const c = contacts.filter((k) => norm(k.name).includes(norm(x)));
    if (c.length === 1) return { address: c[0].email, name: c[0].name };
    if (t.length + c.length > 1) fail(`"${x}" matches several people (${[...t.map((u) => u.name), ...c.map((k) => k.name)].slice(0, 6).join(", ")}). Use the email address.`);
    fail(`No email address on file for "${x}". Give the email address.`);
  });
}
const recip = (list) => list.map((r) => ({ emailAddress: { address: r.address, ...(r.name ? { name: r.name } : {}) } }));
async function propFolder(db, property) {
  const { p } = findProp(await loadProps(db), property);
  const f = p.filesFolder;
  if (!f || !f.driveId || !f.id) fail(`${addrOf(p)} has no OneDrive folder linked in the app yet (property → Files → link a folder).`);
  return { p, driveId: f.driveId, id: f.id };
}
async function subFolder(f, name, create) {
  if (!name) return f.id;
  const kids = await graph("GET", `/drives/${encodeURIComponent(f.driveId)}/items/${encodeURIComponent(f.id)}/children?$top=200&$select=id,name,folder`);
  const hit = (kids.value || []).find((k) => k.folder && norm(k.name) === norm(name)) || (kids.value || []).find((k) => k.folder && norm(k.name).includes(norm(name)));
  if (hit) return hit.id;
  if (!create) fail(`No folder "${name}" in ${addrOf(f.p)}'s files.`);
  const made = await graph("POST", `/drives/${encodeURIComponent(f.driveId)}/items/${encodeURIComponent(f.id)}/children`, { name: String(name).slice(0, 120), folder: {}, "@microsoft.graph.conflictBehavior": "rename" });
  return made.id;
}
async function readBytes(res) { if (!res.ok) { const e = new Error(`Microsoft ${res.status}`); e.status = res.status; if (res.status === 403) e.permission = true; throw e; } return Buffer.from(await res.arrayBuffer()); }
// Attach bytes to a draft (small inline; big via upload session).
async function attachToDraft(mb, msgId, name, buf, contentType) {
  if (buf.length <= 3 * 1024 * 1024) {
    return graph("POST", `/users/${mb}/messages/${encodeURIComponent(msgId)}/attachments`, { "@odata.type": "#microsoft.graph.fileAttachment", name, contentType: contentType || "application/octet-stream", contentBytes: buf.toString("base64") });
  }
  const sess = await graph("POST", `/users/${mb}/messages/${encodeURIComponent(msgId)}/attachments/createUploadSession`, { AttachmentItem: { attachmentType: "file", name, size: buf.length } });
  const CH = 10 * 320 * 1024; // Graph: every chunk but the last must be a multiple of 320 KiB
  for (let i = 0; i < buf.length; i += CH) {
    const part = buf.subarray(i, Math.min(i + CH, buf.length));
    const r = await fetch(sess.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/octet-stream", "Content-Length": String(part.length), "Content-Range": `bytes ${i}-${i + part.length - 1}/${buf.length}` }, body: part });
    if (!r.ok && r.status !== 200 && r.status !== 201) throw new Error(`Attachment upload failed (${r.status})`);
  }
  return {};
}
// Gather attachments: {property, file} from a property folder, or {email_id, attachment} from an email.
async function gatherFiles(db, mb, list) {
  const out = [];
  let total = 0;
  for (const it of list || []) {
    if (it && it.property && it.file) {
      const f = await propFolder(db, it.property);
      // Find it in the folder listing first (the same call list_property_files
      // makes, which works); search() only as a fallback for subfolders.
      const kids = ((await graph("GET", `/drives/${encodeURIComponent(f.driveId)}/items/${encodeURIComponent(f.id)}/children?$top=200&$select=id,name,size,file`)).value || []).filter((x) => x.file);
      let files = kids.filter((x) => norm(x.name).includes(norm(it.file)));
      if (!files.length) {
        const res = await graph("GET", `/drives/${encodeURIComponent(f.driveId)}/items/${encodeURIComponent(f.id)}/search(q='${encodeURIComponent(String(it.file).replace(/'/g, "''"))}')?$select=id,name,size,file`);
        files = (res.value || []).filter((x) => x.file);
      }
      const hit = files.find((x) => norm(x.name) === norm(it.file)) || files[0];
      if (!hit) fail(`No file like "${it.file}" in ${addrOf(f.p)}'s folder.`);
      // Download through the item's pre-signed link (no Authorization header):
      // /content answers with a redirect to SharePoint, and following it with
      // the Graph token is refused with 401/403 - which read as "no
      // permission" even though listing the folder works (Elie 11/4/26).
      const item = await graph("GET", `/drives/${encodeURIComponent(f.driveId)}/items/${encodeURIComponent(hit.id)}`);
      const dl = item && item["@microsoft.graph.downloadUrl"];
      const buf = await readBytes(dl ? await fetch(dl) : await graph("GET", `/drives/${encodeURIComponent(f.driveId)}/items/${encodeURIComponent(hit.id)}/content`, null, { raw: true }));
      out.push({ name: hit.name, buf, type: (hit.file && hit.file.mimeType) || "application/octet-stream" }); total += buf.length;
    } else if (it && it.email_id) {
      const atts = (await graph("GET", `/users/${mb}/messages/${encodeURIComponent(it.email_id)}/attachments?$select=id,name,contentType,size,isInline`)).value || [];
      const pick = atts.filter((x) => !x.isInline && (!it.attachment || x.id === it.attachment || norm(x.name).includes(norm(it.attachment))));
      if (!pick.length) fail(`That email has no attachment like "${it.attachment || ""}".`);
      for (const x of pick) {
        const buf = await readBytes(await graph("GET", `/users/${mb}/messages/${encodeURIComponent(it.email_id)}/attachments/${encodeURIComponent(x.id)}/$value`, null, { raw: true }));
        out.push({ name: x.name, buf, type: x.contentType }); total += buf.length;
      }
    } else if (it && it.url) {
      // Only our own storage (e.g. a scope-of-work PDF from create_scope_of_work).
      if (!String(it.url).startsWith(STORAGE_PUBLIC)) fail("Only links to Goldstone's own files can be attached.");
      const res = await fetch(it.url);
      if (!res.ok) fail("Couldn't download that file.");
      const buf = Buffer.from(await res.arrayBuffer());
      const name = it.name || decodeURIComponent(String(it.url).split("/").pop().split("?")[0]).replace(/^\d+-[a-z0-9]+-/, "");
      out.push({ name, buf, type: res.headers.get("content-type") || "application/octet-stream" }); total += buf.length;
    } else fail('Each attachment needs {property, file}, {email_id, attachment} or {url}.');
    if (total > 30 * 1024 * 1024) fail("Attachments are over 30 MB — send a link instead.");
  }
  return out;
}

// ── Chat replies (the app's ↩ Reply) ────────────────────────────────────────
// Same wording the app shows for an attachment-only message (src/net.js attLabel).
export const attLabelS = (a) => {
  if (!a) return "";
  const k = a.kind || "";
  if (k === "images") { const n = (a.items || []).length; return n > 1 ? `📷 ${n} photos sent` : "📷 Photo sent"; }
  if (k === "image") return "📷 Photo sent";
  if (k === "video") return "🎥 Video sent";
  if (k === "audio") return "🎤 Voice note sent";
  return "📎 Attachment sent";
};
// The quote the bubble shows: original sender + first 140 characters.
export const quoteText = (m) => String((m && m.text) || attLabelS(m && m.attachment)).slice(0, 140);
const cleanId = (v) => String(v == null ? "" : v).trim().replace(/^#/, "");
// Find a message by id in a property's chat (+ its task chats) or the Office
// Chat (+ Company-task chats). → {m, task|null} or {ctr:true} for a contractor
// job-chat message ("ctr-<id>" in the app's merged property chat) or null.
async function findChatMsg(db, loc, rawId) {
  const id = cleanId(rawId);
  if (!id) return null;
  if (/^ctr-/i.test(id)) return { ctr: true, id: id.replace(/^ctr-/i, "") };
  if (loc.pid === OFFICE) {
    const { data } = await db.from("office_messages").select("id,data");
    const r = (data || []).find((x) => x.data && (String(x.data.id) === id || String(x.id) === id));
    if (r) return { m: r.data, task: null };
  } else {
    const m = ((loc.prop && loc.prop.messages) || []).find((x) => x && String(x.id) === id);
    if (m) return { m, task: null };
  }
  for (const t of loc.tasks || []) { const m = (t.messages || []).find((x) => x && String(x.id) === id); if (m) return { m, task: t }; }
  if (loc.pid !== OFFICE && loc.prop) {
    // A contractor's message shown in this property's chat, by its raw id.
    const { data } = await db.from("contractor_messages").select("id,data").eq("id", id).maybeSingle();
    if (data && data.data) return { ctr: true, id };
  }
  return null;
}
// One chat line with its id — what Claude passes back as reply_to.
export const chatLine = (m, extra = "") => `• [id ${m.id}] ${fmtDate(m.at)} ${nyTimeOf(m.at)} ${first(m.author) || "—"}${extra}: ${m.replyTo ? `↩ (replying to ${first(m.replyTo.author)}: "${String(m.replyTo.text || "").slice(0, 60)}") ` : ""}${String(m.text || attLabelS(m.attachment)).replace(/\s+/g, " ").slice(0, 400)}`;
const nyTimeOf = (iso) => { try { return new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };

// ── Tools ────────────────────────────────────────────────────────────────────
const S = (props, required = []) => ({ type: "object", properties: props, required, additionalProperties: false });
const str = (d) => ({ type: "string", description: d });
const P = str('Property: part of the address (e.g. "19 Orchard"), or "company"/"office" for Company tasks and the general Office Chat.');
const TK = str('Task: its #id or words from its name.');

export const TOOLS = [
  { name: "find_properties", title: "Find properties", description: "List the team's properties (address, status, open-task count). Optional search text and/or status filter (Under Contract, Purchased, Under Construction, On Market, Attorney Review, In Closing, Sold, Rental).",
    inputSchema: S({ query: str("Part of an address or town (optional)."), status: str("Only this status (optional).") }), annotations: { readOnlyHint: true } },
  { name: "get_property", title: "Property details", description: "One property: status, address, its open tasks (with checklists) and the latest team chat messages (each with its [id] — use it as reply_to).",
    inputSchema: S({ property: P }, ["property"]), annotations: { readOnlyHint: true } },
  { name: "list_tasks", title: "List tasks", description: 'Tasks across all properties and Company tasks. who = "me" (default), a teammate\'s name, "everyone" or "unassigned". status = open (default) | done | all.',
    inputSchema: S({ who: str('Whose tasks (default "me").'), property: str("Limit to one property (optional)."), status: { type: "string", enum: ["open", "done", "all"] }, urgent_only: { type: "boolean" } }), annotations: { readOnlyHint: true } },
  { name: "add_task", title: "Add a task", description: "Create a task on a property (or Company tasks). Optional assignee (owner), delegate (who does the work), urgent flag and checklist items. The people involved get a notification.",
    inputSchema: S({ property: P, text: str("What needs to be done."), assignee: str("Owner — teammate name (default: me)."), delegate: str("Teammate doing the work (optional)."), urgent: { type: "boolean" }, checklist: { type: "array", items: { type: "string" }, description: "Checklist sub-items (optional)." } }, ["property", "text"]) },
  { name: "update_task", title: "Update a task", description: "Change a task: complete or reopen it, mark/unmark urgent, change owner or delegate, rename, or add checklist items.",
    inputSchema: S({ property: P, task: TK, complete: { type: "boolean" }, reopen: { type: "boolean" }, urgent: { type: "boolean" }, assignee: str("New owner (optional)."), delegate: str('New delegate, or "none" to clear (optional).'), rename: str("New task name (optional)."), add_checklist_items: { type: "array", items: { type: "string" } } }, ["property", "task"]) },
  { name: "tick_checklist_item", title: "Tick a checklist item", description: "Tick (or untick) one checklist item inside a task. Ticking the last item completes the task automatically.",
    inputSchema: S({ property: P, task: TK, item: str("Words from the checklist item."), done: { type: "boolean", description: "true = tick (default), false = untick." } }, ["property", "task", "item"]) },
  { name: "post_message", title: "Post a team message", description: 'Post a message in a property\'s team chat, in a task\'s conversation (give task), or in the general 📌 Office Chat (property "office", no task — the whole team gets a push). notify = teammates to @-mention and push. REPLIES: when the user says "reply to that message", "reply to what Esti said", "answer her" etc., ALWAYS pass reply_to = the id of that message (from read_chat / get_property / unread_messages) — it posts a true threaded reply exactly like the app\'s ↩ Reply arrow: a quote box with the original sender and their text on top, in the same thread (or task) as the original, and the original sender gets notified. A contractor\'s message (id "ctr-…") is answered with message_contractor instead.',
    inputSchema: S({ property: P, text: str("The message."), task: str("Task #id or name — post in that task's conversation instead (optional)."), reply_to: str("Id of the message being replied to (from read_chat, get_property or unread_messages). Optional."), notify: { type: "array", items: { type: "string" }, description: "Teammates to notify (optional)." } }, ["property", "text"]) },
  { name: "read_chat", title: "Read a team chat", description: 'Read a property\'s team chat (with its task chats and contractor job-chat messages mixed in, as the app shows them), one task\'s conversation (give task), or the 📌 Office Chat (property "office"). Every message comes with its [id], sender, time and text — pass the id as reply_to to post_message (or message_contractor for "ctr-…" ids) to reply to it.',
    inputSchema: S({ property: P, task: str("Only this task's conversation (#id or name, optional)."), limit: { type: "integer", minimum: 1, maximum: 60, description: "How many latest messages (default 20)." } }, ["property"]), annotations: { readOnlyHint: true } },
  { name: "find_contact", title: "Find a contact", description: "Search the contacts directory by name, company, trade or phone. Returns phones and email.",
    inputSchema: S({ query: str("Name, company, trade or number.") }, ["query"]), annotations: { readOnlyHint: true } },
  { name: "send_text", title: "Send a text message", description: "Send an SMS from the signed-in teammate's own business line. ALWAYS show the user the exact recipient and message and get an explicit yes first; then call with confirmed=true. `to` = a phone number or a contact's name.",
    inputSchema: S({ to: str("Phone number or contact name."), message: str("Exact text to send."), property: str("Property this is about (optional — files the conversation)."), confirmed: { type: "boolean", description: "Must be true — only after the user approved this exact text." } }, ["to", "message", "confirmed"]), annotations: { destructiveHint: false, openWorldHint: true } },
  { name: "place_call", title: "Place a phone call", description: "Call someone from the signed-in teammate's own business line (Jivetel click-to-call): their Jivetel phone (desk phone / Jivetel app) rings FIRST — when they pick up, it dials the other person and connects them, showing the business number as caller ID. ALWAYS confirm who and which number first; then call with confirmed=true. `to` = a phone number or a contact's name.",
    inputSchema: S({ to: str("Phone number or contact name."), confirmed: { type: "boolean", description: "Must be true — only after the user confirmed who to call." } }, ["to", "confirmed"]), annotations: { destructiveHint: false, openWorldHint: true } },
  { name: "list_showings", title: "Showings", description: "ShowingTime showings (and inspections/appraisals) for a day — today by default — with the property, agent, agent phone, and whether the agent was texted AFTER the showing to ask how it went (and whether they replied). Use it for 'how many showings today', 'which agents haven't I followed up with'.",
    inputSchema: S({ date: str('today (default), tomorrow, yesterday, or YYYY-MM-DD.'), days: { type: "integer", minimum: 1, maximum: 14, description: "How many days starting at date (default 1)." }, property: str("Only showings for this property (optional).") }), annotations: { readOnlyHint: true } },
  { name: "get_texts", title: "Read a text conversation", description: 'The recent text messages (both directions) with one person, newest last. "with" can be a full number, a contact name, a PARTIAL number ("5551", "555-0142"), or an area code / partial number plus a time ("609 yesterday 3pm", "732 around 11am", "908 Nov 10"). When it isn\'t one clear conversation it lists the close matches (number, saved name or "unsaved", last text) so you can pick one — ask the user which, or call again with the full number.',
    inputSchema: S({ with: str('Phone number, contact name, partial number, or area code + time (e.g. "609 yesterday 3pm").'), limit: { type: "integer", minimum: 1, maximum: 50, description: "How many messages (default 20)." } }, ["with"]), annotations: { readOnlyHint: true } },
  { name: "recent_texts", title: "Recent texts (all conversations)", description: "Every recent text message across ALL conversations on the signed-in teammate's own business line (plus shared lines like the office number) — including numbers that aren't saved as contacts, and including messages already read. Newest first, one line each: time (New York), in/out, number, saved name or \"unsaved\", read/unread (incoming), and the text. Default: the last 24 hours. Read-only.",
    inputSchema: S({ since: str('From when — e.g. "2026-11-10", "yesterday", "yesterday 3pm", "48 hours", "Nov 10 9am" (default: 24 hours ago).'), until: str("Up to when (optional, default now)."), direction: { type: "string", enum: ["incoming", "outgoing", "both"], description: "Default both." }, area_code: str('Only numbers in this area code, e.g. "609".'), number_contains: str('Only numbers containing these digits, e.g. "5551".'), text_contains: str("Only messages containing this word/phrase."), limit: { type: "integer", minimum: 1, maximum: 200, description: "How many (default 50)." } }), annotations: { readOnlyHint: true } },
  { name: "search_email", title: "Search my email", description: "Search the signed-in teammate's own Outlook mailbox. Returns subject, sender, date, attachment names and an id (for read_email / reply_email / attachments).",
    inputSchema: S({ query: str("Words to look for (address, name, subject…)."), from: str("Sender name or email (optional)."), days: { type: "integer", minimum: 1, maximum: 365, description: "Only the last N days (optional)." }, with_attachments: { type: "boolean", description: "Only emails with attachments." }, unread_only: { type: "boolean", description: "Only unread emails (alone = the unread emails in the inbox)." } }), annotations: { readOnlyHint: true } },
  { name: "mark_email_read", title: "Mark emails read / unread", description: "Mark emails in the teammate's own Outlook as read (or unread): specific emails by id (from search_email), or all unread inbox emails — optionally only from one sender.",
    inputSchema: S({ ids: { type: "array", items: { type: "string" }, description: "Email ids from search_email." }, all_unread: { type: "boolean", description: "Every unread email in the inbox." }, from: str("With all_unread: only those from this sender (name or email)."), read: { type: "boolean", description: "true = mark read (default), false = mark unread." } }) },
  { name: "read_email", title: "Read an email", description: "Full text of one email from search_email, with its attachments (ids, names, sizes). To read an attachment (PDF, picture, Word, Excel), use read_file — nothing gets saved.",
    inputSchema: S({ id: str("The email id from search_email.") }, ["id"]), annotations: { readOnlyHint: true } },
  { name: "send_email", title: "Send an email", description: "Send an email from the signed-in teammate's own Outlook. to/cc/bcc take email addresses or names of teammates/contacts. Attachments can come from a property's OneDrive folder ({property, file}) or another email ({email_id, attachment}). ALWAYS show the user the recipients, subject, body and attachments and get an explicit yes first; then call with confirmed=true.",
    inputSchema: S({ to: { type: "array", items: { type: "string" } }, cc: { type: "array", items: { type: "string" } }, bcc: { type: "array", items: { type: "string" } }, subject: str("Subject line."), body: str("Email body (plain text; line breaks kept)."), attachments: { type: "array", description: "{property, file} from a property folder, {email_id, attachment} from an email, or {url, name?} for a PDF made by create_scope_of_work.", items: { type: "object", properties: { property: { type: "string" }, file: { type: "string" }, email_id: { type: "string" }, attachment: { type: "string" }, url: { type: "string" }, name: { type: "string" } } } }, confirmed: { type: "boolean", description: "Must be true — only after the user approved this exact email." } }, ["to", "subject", "body", "confirmed"]), annotations: { destructiveHint: false, openWorldHint: true } },
  { name: "reply_email", title: "Reply to an email", description: "Reply (or reply-all) to an email from search_email, from the teammate's own Outlook — stays in the same thread. Optional extra cc and attachments (same shapes as send_email: {property, file} from a property's OneDrive folder, {email_id, attachment} from another email, or {url, name} for a Goldstone file link). ALWAYS show the user the reply, any cc and the attachments, and get a yes first; then confirmed=true.",
    inputSchema: S({ id: str("The email id."), body: str("Reply text."), reply_all: { type: "boolean" }, cc: { type: "array", items: { type: "string" } }, attachments: { type: "array", description: "{property, file} from a property folder, {email_id, attachment} from another email, or {url, name?} for a Goldstone file link (e.g. a create_scope_of_work PDF).", items: { type: "object", properties: { property: { type: "string" }, file: { type: "string" }, email_id: { type: "string" }, attachment: { type: "string" }, url: { type: "string" }, name: { type: "string" } } } }, confirmed: { type: "boolean" } }, ["id", "body", "confirmed"]), annotations: { destructiveHint: false, openWorldHint: true } },
  { name: "recent_calls", title: "Recent calls", description: "The signed-in teammate's recent phone calls on the Jivetel business lines (their own extension plus shared lines like the main office number): date/time (New York), inbound/outbound, the other number, the matching contact name, length, and answered / missed / voicemail / no answer. Read-only. From the call records (CDRs) Jivetel sends the app for every completed call.",
    inputSchema: S({ days: { type: "integer", minimum: 1, maximum: 90, description: "How far back (default 7)." }, number_or_contact: str("Only calls with this phone number or contact name (optional)."), direction: { type: "string", enum: ["inbound", "outbound", "missed", "all"], description: "Default all. missed = inbound calls nobody picked up (incl. voicemail)." }, limit: { type: "integer", minimum: 1, maximum: 200, description: "How many calls, newest first (default 25)." } }), annotations: { readOnlyHint: true } },
  { name: "read_file", title: "Read a file (PDF, picture, Word, Excel)", description: "Open a file and read what's inside WITHOUT saving it anywhere: an email attachment ({email_id, attachment}), a file in a property's OneDrive folder ({property, file}), or a Goldstone file link ({url}, e.g. a chat attachment). PDFs come back as text page by page (scanned pages as pictures); pictures as pictures; Word/Excel/text as text. Long PDFs: use pages (e.g. \"1-10\").",
    inputSchema: S({ email_id: str("The email id from search_email (for an attachment)."), attachment: str("Attachment name or id (optional when the email has just one)."), property: str("Property whose OneDrive folder has the file."), file: str("File name (or part of it) in that property's folder."), url: str("A Goldstone file link (chat attachment, scope of work…)."), pages: str('PDF pages to read, e.g. "1-10" or "3,5" (optional, default all).') }), annotations: { readOnlyHint: true } },
  { name: "list_property_files", title: "Property files", description: "List the files in a property's linked OneDrive/SharePoint folder (optionally a subfolder).",
    inputSchema: S({ property: P, folder: str("Subfolder name (optional).") }, ["property"]), annotations: { readOnlyHint: true } },
  { name: "save_email_attachment", title: "Save an email attachment to a property", description: "Copy an attachment (or all attachments) from an email into a property's OneDrive folder, optionally into a subfolder (created if missing).",
    inputSchema: S({ email_id: str("The email id from search_email."), attachment: str('Attachment name or id — or "all".'), property: P, folder: str("Subfolder to save into (optional).") }, ["email_id", "property"]) },
  { name: "mortgage_status", title: "Mortgage payments status", description: "This month's (or a given month's) mortgage-payments checklist: which properties are paid (and how QuickBooks saw it) and which are not.",
    inputSchema: S({ month: str("YYYY-MM (optional, default this month).") }), annotations: { readOnlyHint: true } },
  { name: "team_members", title: "Team members", description: "The Goldstone team members (names you can assign tasks to).",
    inputSchema: S({}), annotations: { readOnlyHint: true } },
];

export async function runTool(name, args, me) {
  const db = admin();
  const a = args || {};
  switch (name) {
    case "team_members": {
      const team = await loadTeam(db);
      return `Team: ${team.map((u) => u.name).join(", ")}. You are ${me.name}.`;
    }
    case "find_properties": {
      let rows = await loadProps(db);
      if (a.status) rows = rows.filter((r) => norm(r.p.status) === norm(a.status));
      if (a.query) { const q = norm(a.query); rows = rows.filter((r) => norm(`${addrOf(r.p)} ${r.p.zip || ""}`).includes(q)); }
      if (!rows.length) return "No properties match.";
      return rows.slice(0, 60).map((r) => `${addrOf(r.p)} — ${r.p.status || "—"} · ${(r.p.tasks || []).filter((t) => t && !t.deleted && !isDone(t)).length} open tasks`).join("\n") + (rows.length > 60 ? `\n…and ${rows.length - 60} more (search to narrow).` : "");
    }
    case "get_property": {
      const props = await loadProps(db);
      const { p } = findProp(props, a.property);
      const open = (p.tasks || []).filter((t) => t && !t.deleted && !isDone(t));
      const msgs = (p.messages || []).slice(-8);
      return [
        `${addrOf(p)}${p.state ? ` ${p.state}` : ""} — status: ${p.status || "—"}`,
        `Open tasks (${open.length}):`,
        ...(open.length ? open.map((t) => "• " + taskLine(t) + (subsOf(t).length ? "\n    " + subsOf(t).map((s) => `${s.done ? "☑" : "☐"} ${s.text}`).join("\n    ") : "")) : ["• none"]),
        `Latest team chat:`,
        ...(msgs.length ? msgs.map((m) => chatLine(m)) : ["• no messages"]),
      ].join("\n");
    }
    case "list_tasks": {
      const team = await loadTeam(db);
      const who = String(a.who || "me").trim();
      const status = a.status || "open";
      const props = await loadProps(db);
      const office = await loadOffice(db);
      let rows = [
        ...office.map((r) => ({ label: "Company", t: r.t })),
        ...props.flatMap((r) => (r.p.tasks || []).filter((t) => t && !t.deleted).map((t) => ({ label: addrOf(r.p), t }))),
      ];
      if (a.property) {
        if (COMPANY.includes(norm(a.property))) rows = rows.filter((x) => x.label === "Company");
        else { const { p } = findProp(props, a.property); rows = rows.filter((x) => x.label === addrOf(p)); }
      }
      if (/^(everyone|all)$/i.test(who)) { /* all */ }
      else if (/^unassigned$/i.test(who)) rows = rows.filter((x) => !x.t.assignee);
      else { const n = resolvePerson(team, me, who); rows = rows.filter((x) => x.t.assignee === n || x.t.delegate === n); }
      if (status === "open") rows = rows.filter((x) => !isDone(x.t));
      else if (status === "done") rows = rows.filter((x) => isDone(x.t));
      if (a.urgent_only) rows = rows.filter((x) => x.t.urgent && !isDone(x.t));
      rows.sort((x, y) => (!!y.t.urgent - !!x.t.urgent) || x.label.localeCompare(y.label, undefined, { numeric: true }));
      if (!rows.length) return "No tasks match.";
      const out = rows.slice(0, 80).map((x) => `${x.label}: ${taskLine(x.t)}`);
      return `${rows.length} task${rows.length === 1 ? "" : "s"}:\n` + out.join("\n") + (rows.length > 80 ? `\n…and ${rows.length - 80} more.` : "");
    }
    case "add_task": {
      const text = String(a.text || "").trim();
      if (!text) fail("What's the task?");
      const team = await loadTeam(db);
      const assignee = a.assignee ? resolvePerson(team, me, a.assignee) : me.name;
      const delegate = a.delegate ? resolvePerson(team, me, a.delegate) : "";
      const loc = await locate(db, a.property);
      const id = newId();
      const subs = (a.checklist || []).map((x) => String(x || "").trim()).filter(Boolean).map((t, i) => ({ id: id + 100 + i, text: t, done: false }));
      const task = { id, text, status: "Not Started", assignee, delegate: delegate && delegate !== assignee ? delegate : "", cat: "Custom", assignedAt: Date.now(), assignedBy: me.name, ...(a.urgent ? { urgent: true, urgentAt: Date.now(), urgentBy: me.name } : {}), ...(subs.length ? { subtasks: subs } : {}) };
      await loc.add(task);
      await ping(db, me, [task.assignee, task.delegate], { title: task.urgent ? "🚨 URGENT task for you" : "New task for you", body: `${me.name}: ${text} — ${loc.label}`, url: goto(loc.pid, id), tag: `newtask-${id}` });
      return `Added on ${loc.label}: ${taskLine(task)}${subs.length ? `\nChecklist: ${subs.map((s) => s.text).join(", ")}` : ""}`;
    }
    case "update_task": {
      const team = await loadTeam(db);
      const loc = await locate(db, a.property);
      const t0 = findTask(loc.tasks, a.task, loc.label);
      const changes = [];
      const next = await loc.update(t0.id, (t) => {
        let x = { ...t };
        if (a.complete) { x = { ...x, status: "Completed", completedAt: nowIso(), completedBy: me.name }; changes.push("completed"); }
        if (a.reopen) { x = { ...x, status: "Not Started", completedAt: null, completedBy: null, subAutoDone: false }; changes.push("reopened"); }
        if (typeof a.urgent === "boolean") { x = { ...x, urgent: a.urgent, urgentAt: a.urgent ? Date.now() : null, urgentBy: a.urgent ? me.name : null }; changes.push(a.urgent ? "marked urgent" : "urgent removed"); }
        if (a.assignee) { x.assignee = resolvePerson(team, me, a.assignee); if (x.delegate === x.assignee) x.delegate = ""; changes.push(`owner → ${x.assignee}`); }
        if (a.delegate) { x.delegate = /^(none|nobody|clear)$/i.test(a.delegate) ? "" : resolvePerson(team, me, a.delegate); if (x.delegate === x.assignee) x.delegate = ""; changes.push(x.delegate ? `delegated → ${x.delegate}` : "delegate cleared"); }
        if (a.rename && String(a.rename).trim()) { x.text = String(a.rename).trim(); changes.push("renamed"); }
        if (Array.isArray(a.add_checklist_items) && a.add_checklist_items.length) {
          const add = a.add_checklist_items.map((s) => String(s || "").trim()).filter(Boolean).map((s, i) => ({ id: newId() + i, text: s, done: false }));
          x = withSubs(x, [...subsOf(x), ...add], me.name); changes.push(`+${add.length} checklist item${add.length === 1 ? "" : "s"}`);
        }
        return x;
      });
      if (!changes.length) return "Nothing to change — say what to update.";
      if (a.urgent) await ping(db, me, [next.assignee, next.delegate], { title: "🚨 URGENT task", body: `${me.name}: ${next.text} — ${loc.label}`, url: goto(loc.pid, next.id), tag: `urgent-task-${next.id}` });
      if (a.assignee || a.delegate) await ping(db, me, [next.assignee, next.delegate], { title: "New task for you", body: `${me.name}: ${next.text} — ${loc.label}`, url: goto(loc.pid, next.id), tag: `newtask-${next.id}` });
      return `${loc.label}: ${changes.join(", ")}.\n${taskLine(next)}`;
    }
    case "tick_checklist_item": {
      const loc = await locate(db, a.property);
      const t0 = findTask(loc.tasks, a.task, loc.label);
      const subs = subsOf(t0);
      if (!subs.length) fail(`"${t0.text}" has no checklist.`);
      const nq = norm(a.item);
      const hits = subs.filter((s) => norm(s.text).includes(nq));
      if (!hits.length) fail(`No checklist item matching "${a.item}". Items: ${subs.map((s) => s.text).join(", ")}.`);
      if (hits.length > 1 && !hits.some((s) => norm(s.text) === nq)) fail(`"${a.item}" matches several items: ${hits.map((s) => s.text).join(", ")}.`);
      const target = hits.find((s) => norm(s.text) === nq) || hits[0];
      const on = a.done !== false;
      const next = await loc.update(t0.id, (t) => withSubs(t, subsOf(t).map((s) => (s.id !== target.id ? s : on ? { ...s, done: true, doneAt: nowIso(), doneBy: me.name } : { ...s, done: false, doneAt: null, doneBy: null, qb: null })), me.name));
      const d = subsOf(next).filter((s) => s.done).length;
      return `${on ? "Ticked" : "Unticked"} "${target.text}" on ${next.text} (${loc.label}) — ${d}/${subsOf(next).length} done${isDone(next) ? ". All done — task completed." : "."}`;
    }
    case "post_message": {
      const text = String(a.text || "").trim();
      if (!text) fail("What's the message?");
      const team = await loadTeam(db);
      const mentions = (a.notify || []).map((n) => resolvePerson(team, me, n)).filter((n) => n !== me.name);
      const msg = { id: newId(), author: me.name, text, at: nowIso(), readBy: [me.name], via: "claude" };
      const loc = await locate(db, a.property);
      // ↩ Reply: the same fields the app's Reply arrow writes (replyToId +
      // replyTo {id, author, text ≤140, taskText}); posted where the original lives.
      let target = null, note = "";
      if (a.reply_to != null && String(a.reply_to).trim()) {
        const hit = await findChatMsg(db, loc, a.reply_to);
        if (hit && hit.ctr) fail(`Message ${cleanId(a.reply_to)} is a contractor's job-chat message — reply with message_contractor (reply_to "${hit.id}") so it reaches the contractor.`);
        if (hit) target = hit;
        else note = ` (couldn't find message ${cleanId(a.reply_to)} in ${loc.label} — posted as a normal message, not a reply)`;
      }
      if (target) {
        const o = target.m;
        msg.replyToId = o.id;
        msg.replyTo = { id: o.id, author: o.author || "", text: quoteText(o), taskText: (target.task && target.task.text) || o.taskText || null };
        if (o.author && o.author !== me.name && !mentions.includes(o.author)) mentions.push(o.author);
        if (o.showingKey) { msg.showingKey = o.showingKey; msg.showingLabel = o.showingLabel || null; }
      }
      if (mentions.length) msg.mentions = mentions;
      const quoted = target ? ` as a reply to ${first(target.m.author)} ("${quoteText(target.m).slice(0, 60)}")` : "";
      const t0 = target ? target.task : a.task ? findTask(loc.tasks, a.task, loc.label) : null;
      if (t0) {
        await loc.update(t0.id, (t) => ({ ...t, messages: [...(t.messages || []), msg] }));
        if (mentions.length) await ping(db, me, mentions, { title: `${loc.prop ? `${loc.label} · ` : ""}Task: ${t0.text}`, body: `${me.name}: ${text}`, url: goto(loc.pid, t0.id), tag: `task-${t0.id}` });
        return `Posted in "${t0.text}" (${loc.label})${quoted}${mentions.length ? ` and notified ${mentions.map(first).join(", ")}` : ""}${note}.`;
      }
      if (loc.pid === OFFICE) {
        // 📌 Office Chat — the whole-team general thread (same as typing in it in the app: everyone gets a push).
        const { error } = await db.from("office_messages").insert({ id: String(msg.id), data: msg });
        if (error) fail(`Couldn't post: ${error.message}`);
        try { await notifyFanout(db, me.id, { toTeam: true, title: "📌 Office Chat", body: `${me.name}: ${text}`, url: "/?goto=chat:__office__", tag: "office" }); } catch { /* best effort */ }
        return `Posted in the 📌 Office Chat${quoted} — the whole team was notified${note}.`;
      }
      await loc.addMsg(msg);
      if (mentions.length) await ping(db, me, mentions, { title: loc.label, body: `${me.name}: ${text}`, url: `/?goto=chat:${loc.pid}`, tag: `chat-${loc.pid}` });
      return `Posted in the ${loc.label} team chat${quoted}${mentions.length ? ` and notified ${mentions.map(first).join(", ")}` : ""}${note}.`;
    }
    case "read_chat": {
      const lim = Math.max(1, Math.min(60, Number(a.limit) || 20));
      const loc = await locate(db, a.property);
      let rows = [];
      if (a.task) {
        const t0 = findTask(loc.tasks, a.task, loc.label);
        rows = (t0.messages || []).map((m) => ({ m, extra: "" }));
        const list = rows.sort((x, y) => String(x.m.at).localeCompare(String(y.m.at))).slice(-lim);
        return `"${t0.text}" (${loc.label}) — ${list.length ? `last ${list.length} of ${rows.length} messages` : "no messages yet"}:\n${list.map((x) => chatLine(x.m)).join("\n")}`;
      }
      if (loc.pid === OFFICE) {
        const { data } = await db.from("office_messages").select("id,data");
        rows = (data || []).map((r) => r.data).filter(Boolean).map((m) => ({ m, extra: "" }));
      } else {
        rows = ((loc.prop && loc.prop.messages) || []).filter((m) => m && !m.deleted).map((m) => ({ m, extra: m.showingLabel ? ` [showing: ${m.showingLabel}]` : "" }));
        // Contractor job-chat messages show in the property chat in the app too ("ctr-<id>").
        const [{ data: cm }, { data: cj }] = await Promise.all([db.from("contractor_messages").select("id,data"), db.from("contractor_jobs").select("id,data")]);
        const jobs = new Map((cj || []).map((r) => r.data).filter((j) => j && (String(j.propertyId) === String(loc.pid) || norm(j.propertyAddress).includes(norm(loc.prop.address)))).map((j) => [String(j.id), j]));
        (cm || []).map((r) => r.data).filter((m) => m && jobs.has(String(m.jobId))).forEach((m) => rows.push({ m: { ...m, id: `ctr-${m.id}` }, extra: ` [contractor chat${m.side === "contractor" ? ", contractor" : ""}${jobs.get(String(m.jobId)).title ? ` — ${jobs.get(String(m.jobId)).title}` : ""}]` }));
      }
      (loc.tasks || []).forEach((t) => (t.messages || []).forEach((m) => rows.push({ m, extra: ` [task "${t.text}"]` })));
      rows.sort((x, y) => String(x.m.at).localeCompare(String(y.m.at)));
      const list = rows.slice(-lim);
      if (!list.length) return `No messages yet in ${loc.pid === OFFICE ? "the Office Chat" : `the ${loc.label} chat`}.`;
      return `${loc.pid === OFFICE ? "📌 Office Chat" : `${loc.label} team chat`} — last ${list.length} of ${rows.length} messages (oldest first; reply with post_message reply_to=<id>, or message_contractor for ctr- ids):\n${list.map((x) => chatLine(x.m, x.extra)).join("\n")}`;
    }
    case "find_contact": {
      const q = norm(a.query), digits = String(a.query || "").replace(/\D/g, "");
      const { data } = await db.from("contacts").select("data");
      const hits = (data || []).map((r) => r.data).filter(Boolean).filter((c) => {
        const hay = norm([c.name, c.company, c.role, ...(c.tags || []), c.email].filter(Boolean).join(" "));
        const nums = (c.phones || []).map((p) => String(p.number || "").replace(/\D/g, "")).concat(String(c.phone || "").replace(/\D/g, ""));
        return (q && hay.includes(q)) || (digits.length >= 4 && nums.some((n) => n.includes(digits)));
      });
      if (!hits.length) return `No contact matches "${a.query}".`;
      return hits.slice(0, 15).map((c) => `${c.name || "—"}${c.company ? ` · ${c.company}` : ""}${c.role ? ` · ${c.role}` : ""}\n   ${[...(c.phones || []).map((p) => `${p.label || "Phone"} ${p.number}`), c.phone && !(c.phones || []).length ? `Phone ${c.phone}` : "", c.email ? `Email ${c.email}` : ""].filter(Boolean).join(" · ") || "no phone/email"}`).join("\n");
    }
    case "send_text": {
      if (a.confirmed !== true) fail("Not sent. Show the user the exact recipient and message, get their OK, then call again with confirmed=true.");
      const r = await sendSmsAs(db, me, a.to, a.message, a.property);
      return `Sent from ${first(r.person)}'s line to ${r.toName ? `${r.toName} (${r.to})` : r.to}: "${r.message}"`;
    }
    case "place_call": {
      let to = String(a.to || "").trim(), toName = "";
      if (!to) fail("Who should I call?");
      if (to.replace(/\D/g, "").length < 10) { const c = await contactPhone(db, to); to = c.num; toName = c.name; }
      if (!e164(to)) fail(`"${a.to}" isn't a phone number I can call.`);
      if (a.confirmed !== true) fail(`Not calling yet. Confirm with the user: call ${toName ? `${toName} at ` : ""}${e164(to)}? Then call again with confirmed=true.`);
      const gate = await checkOutreach(to, me.name, "call");
      if (!gate.allowed) fail(`This is ${first(gate.owner)}'s contact — ${first(gate.owner)} got an approval request. Once approved you can call them.`);
      const user = { id: me.id, email: me.email, user_metadata: { name: me.name } };
      const { person, creds, ani } = resolveCallPerson(user, me.name, me.name);
      const out = await click2call({ person, creds, ani, to });
      if (out.status !== 200) fail(out.body.error || "The call didn't go through.");
      return `📞 Calling ${toName ? `${toName} (${e164(to)})` : e164(to)} from ${first(person || me.name)}'s business line${ani ? ` (${e164(ani)})` : ""}. Your Jivetel phone (desk phone / Jivetel app) is ringing now — pick it up and it connects you.`;
    }
    case "list_showings": {
      const day0 = parseDay(a.date);
      const days = Math.max(1, Math.min(14, Number(a.days) || 1));
      const daySet = new Set(Array.from({ length: days }, (_, i) => nyDate(new Date(nyLocalToMs(`${day0}T12:00`) + i * 86400000))));
      let data;
      try { data = await fetchShowings(); } catch (e) { fail(`Couldn't read ShowingTime right now: ${e.message}`); }
      if (!data.configured) return "ShowingTime isn't connected in the app (Showings page → settings).";
      const props = (await loadProps(db)).map((r) => r.p);
      let list = (data.showings || []).filter((s) => daySet.has(showNyDate(s))).map((s) => {
        const where = s.location || s.summary || "";
        const p = props.find((x) => showingMatchesProperty(where, x) || showingMatchesProperty(s.summary || "", x));
        const ckey = `${String(s.start || "").slice(0, 16)}|${String(s.agent || s.summary || s.location || "").toLowerCase()}`;
        const extra = p && p.showingPhones ? [].concat(p.showingPhones[ckey] || []) : [];
        const phones = [...new Set([s.phone, ...extra].filter(Boolean).map((x) => e164(String(x))).filter(Boolean))];
        return { s, p, where, phones, at: showStartMs(s) };
      });
      if (a.property) {
        const { p: want } = findProp(await loadProps(db), a.property);
        list = list.filter((x) => x.p && String(x.p.id) === String(want.id));
      }
      list.sort((x, y) => x.at - y.at);
      const label = days === 1 ? (day0 === nyDate() ? "today" : day0) : `${day0} + ${days - 1} day${days > 2 ? "s" : ""}`;
      if (!list.length) return `No showings ${label === "today" ? "today" : `for ${label}`}.`;
      const sms = await smsFor(db, list.flatMap((x) => x.phones), me);
      const now = Date.now();
      let notTexted = 0;
      const lines = list.map((x) => {
        const after = sms.filter((m) => x.phones.includes(m.phone) && Date.parse(m.at) >= x.at);
        const out = after.filter((m) => String(m.direction).startsWith("out") && m.kind !== "call").sort((a2, b2) => String(a2.at).localeCompare(String(b2.at)));
        const inn = after.filter((m) => m.direction === "in");
        const done = x.at < now;
        let follow;
        if (!x.phones.length) follow = "no agent phone on file";
        else if (out.length) follow = `✅ texted ${nyWhen(out[0].at)} by ${first(out[0].by) || "—"}${inn.length ? ` · agent replied: "${String(inn.sort((a2, b2) => String(b2.at).localeCompare(String(a2.at)))[0].text || "").slice(0, 120)}"` : " · no reply yet"}`;
        else if (done) { follow = "❌ not texted since the showing"; notTexted++; }
        else follow = "upcoming";
        const kind = x.s.kind && x.s.kind !== "showing" ? ` [${x.s.kind}]` : "";
        const when = isNaN(x.at) ? "all day" : (days > 1 ? `${showNyDate(x.s)} ` : "") + nyTime(x.at);
        return `• ${when}${kind} — ${x.p ? addrOf(x.p) : x.where || "unknown address"}\n   Agent: ${x.s.agent || "—"}${x.s.broker ? ` (${x.s.broker})` : ""}${x.phones.length ? ` · ${x.phones.join(", ")}` : ""}${x.s.email ? ` · ${x.s.email}` : ""}\n   Follow-up: ${follow}`;
      });
      const head = `${list.length} showing${list.length === 1 ? "" : "s"} ${label === "today" ? "today" : `for ${label}`}${notTexted ? ` · ${notTexted} not followed up yet` : ""}${data.feedErrors ? ` (couldn't reach: ${data.feedErrors.join(", ")})` : ""}${me.role !== "admin" ? " (follow-up = your own texts)" : ""}:`;
      return [head, ...lines].join("\n");
    }
    case "get_texts": {
      const raw = String(a.with || "").trim();
      if (!raw) fail("Whose texts? Give a number, a name, or an area code + time.");
      const lim = Math.max(1, Math.min(50, Number(a.limit) || 20));
      const names = await savedNames(db);
      const label = (ph) => { const n = names.get(last10(ph)); return n ? `${n} (${prettyPhone(ph)})` : `${prettyPhone(ph)} (unsaved)`; };
      const show = async (phone, who, note = "") => {
        const rows = (await smsFor(db, [phone], me)).filter((m) => m.kind !== "call");
        if (!rows.length) return null;
        const shown = rows.slice(0, lim).reverse();
        return `Texts with ${who || label(phone)}${note} — last ${shown.length}:\n` + shown.map((m) => `• ${nyWhen(m.at)} ${m.direction === "in" ? "← them" : `→ ${first(m.by) || "us"}${m.kind === "cell" ? " (from cell)" : ""}`}: ${String(m.text || (m.media ? "[picture]" : "")).slice(0, 400)}`).join("\n");
      };
      // One line per candidate conversation, for "did you mean".
      const candLines = (list) => list.slice(0, 8).map((c) => `• ${label(c.phone)} — ${c.n} text${c.n === 1 ? "" : "s"}${c.last ? `, last ${nyStamp(c.last.at)} ${c.last.direction === "in" ? "←" : "→"} "${String(c.last.text || (c.last.media ? "[picture]" : "")).replace(/\s+/g, " ").slice(0, 60)}"` : ""}`).join("\n");
      const group = (rows) => { const by = new Map(); rows.forEach((m) => { const c = by.get(m.phone) || { phone: m.phone, n: 0, last: null }; c.n++; if (!c.last || String(m.at) > String(c.last.at)) c.last = m; by.set(m.phone, c); }); return [...by.values()].sort((x, y) => String(y.last.at).localeCompare(String(x.last.at))); };
      // The number part = the first run with 3+ digits that isn't a clock time.
      const numM = /(?:^|[^\d:])(\+?\d[\d\s().-]*\d)(?!\s*(?::|am\b|pm\b|a\b|p\b))/i.exec(raw);
      const numDigits = numM ? numM[1].replace(/\D/g, "") : "";
      if (numDigits.length >= 10) {
        const phone = e164(numDigits);
        const out = await show(phone, "");
        if (out) return out;
        // Nothing with that exact number — close numbers (same last 7 / first 6 digits).
        const near = group(ownLine(await loadTexts(db, { sinceMs: Date.now() - 365 * 86400000 }), me).filter((m) => { const d = last10(m.phone), q = last10(numDigits); return d !== q && (d.slice(-7) === q.slice(-7) || d.slice(0, 6) === q.slice(0, 6) || d.slice(-4) === q.slice(-4)); }));
        fail(`No texts with ${prettyPhone(numDigits)}${me.role === "contractor" ? " that you're part of" : ""}.${near.length ? `\nClose numbers that do have texts:\n${candLines(near)}` : ""}`);
      }
      if (numDigits.length >= 3) {
        // Partial number / area code, optionally with a time ("609 yesterday 3pm").
        const rest = (raw.slice(0, numM.index) + " " + raw.slice(numM.index + numM[0].length)).replace(/\b(around|about|at|on|from)\b/gi, " ").replace(/\s+/g, " ").trim();
        let win = { sinceMs: Date.now() - 180 * 86400000, untilMs: Date.now() }, when = "";
        if (rest) {
          const t = parseWhen(rest);
          if (!t) fail(`I couldn't read the time "${rest}". Try "yesterday 3pm", "Nov 10", "2026-11-10 15:00" or "48 hours".`);
          win = t.hasTime ? { sinceMs: t.ms - 3 * 3600000, untilMs: t.ms + 3 * 3600000 } : { sinceMs: t.ms, untilMs: t.ms + 86400000 - 1 };
          when = t.hasTime ? ` around ${nyStamp(new Date(t.ms).toISOString())}` : ` on ${new Date(t.ms + 43200000).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" })}`;
        }
        const inWin = ownLine(await loadTexts(db, win), me);
        const isArea = numDigits.length === 3 && !/\d{4}/.test(raw);
        const hit = (ph) => (isArea ? last10(ph).startsWith(numDigits) : last10(ph).includes(numDigits) || String(ph).replace(/\D/g, "").includes(numDigits));
        const cands = group(inWin.filter((m) => hit(m.phone)));
        if (cands.length === 1) return (await show(cands[0].phone, "", ` — the only ${isArea ? `${numDigits} number` : `number with "${numDigits}"`}${when}`)) || fail(`No texts with ${prettyPhone(cands[0].phone)} you can see.`);
        if (cands.length > 1) fail(`${cands.length} conversations match ${isArea ? `area code ${numDigits}` : `"${numDigits}"`}${when} — which one?\n${candLines(cands)}${cands.length > 8 ? `\n…and ${cands.length - 8} more (add a time or more digits).` : ""}\nCall again with the full number.`);
        const others = group(inWin);
        fail(`No texts with a number ${isArea ? `in area code ${numDigits}` : `containing "${numDigits}"`}${when}.${others.length ? `\nConversations${when || " in the last 180 days"} you may mean:\n${candLines(others)}` : ""}`);
      }
      // A name: the contacts directory, then the names Jivetel gives incoming texts.
      const q = norm(raw);
      const { data: cd } = await db.from("contacts").select("data");
      const contacts = (cd || []).map((r) => r.data).filter((c) => c && c.name);
      const hits = contacts.filter((c) => norm(c.name).includes(q));
      const exact = hits.filter((c) => norm(c.name) === q);
      const pick = exact.length === 1 ? exact[0] : hits.length === 1 ? hits[0] : null;
      const numOf = (c) => ((c.phones || []).find((p) => p && /mobile|cell/i.test(p.label || "")) || (c.phones || [])[0] || {}).number || c.phone;
      if (pick && numOf(pick)) { const out = await show(e164(numOf(pick)), `${pick.name} (${prettyPhone(numOf(pick))})`); if (out) return out; fail(`No texts with ${pick.name} (${prettyPhone(numOf(pick))}) yet.`); }
      if (hits.length > 1) fail(`"${raw}" matches ${hits.length} contacts:\n${hits.slice(0, 8).map((c) => `• ${c.name}${numOf(c) ? ` — ${prettyPhone(numOf(c))}` : " — no number"}`).join("\n")}\nSay which one (full name or number).`);
      const words = q.split(" ").filter((w) => w.length >= 3);
      const close = contacts.filter((c) => words.some((w) => norm(c.name).split(" ").some((x) => x.startsWith(w.slice(0, 3))))).slice(0, 6);
      const recent = ownLine(await loadTexts(db, { sinceMs: Date.now() - 180 * 86400000 }), me).filter((m) => m.direction === "in" && m.by && words.some((w) => norm(m.by).includes(w.slice(0, 3))));
      const viaCnam = group(recent);
      fail(`No contact named "${raw}".${close.length ? `\nSimilar names in Contacts:\n${close.map((c) => `• ${c.name}${numOf(c) ? ` — ${prettyPhone(numOf(c))}` : ""}`).join("\n")}` : ""}${viaCnam.length ? `\nTexts from numbers whose caller ID looks like that:\n${candLines(viaCnam)}` : ""}${!close.length && !viaCnam.length ? "\nTry the phone number (or part of it), or an area code + time like \"609 yesterday 3pm\"." : ""}`);
    }
    case "recent_texts": {
      const now = Date.now();
      const s0 = a.since ? parseWhen(a.since) : { ms: now - 86400000 };
      if (!s0) fail(`I couldn't read "${a.since}". Try "yesterday", "48 hours", "2026-11-10" or "Nov 10 9am".`);
      const u0 = a.until ? parseWhen(a.until, { end: true }) : { ms: now };
      if (!u0) fail(`I couldn't read "${a.until}".`);
      if (u0.ms < s0.ms) fail("The until time is before the since time.");
      const dir = ["incoming", "outgoing"].includes(a.direction) ? a.direction : "both";
      const lim = Math.max(1, Math.min(200, Number(a.limit) || 50));
      const area = String(a.area_code || "").replace(/\D/g, "");
      const part = String(a.number_contains || "").replace(/\D/g, "");
      const kw = String(a.text_contains || "").trim().toLowerCase();
      let rows = ownLine(await loadTexts(db, { sinceMs: s0.ms, untilMs: u0.ms }), me);
      if (dir !== "both") rows = rows.filter((m) => (dir === "incoming" ? m.direction === "in" : String(m.direction).startsWith("out")));
      if (area) rows = rows.filter((m) => last10(m.phone).startsWith(area));
      if (part) rows = rows.filter((m) => String(m.phone).replace(/\D/g, "").includes(part));
      if (kw) rows = rows.filter((m) => String(m.text || "").toLowerCase().includes(kw));
      const { mine } = linesFor(me);
      const range = `${nyStamp(new Date(s0.ms).toISOString())} – ${a.until ? nyStamp(new Date(u0.ms).toISOString()) : "now"}`;
      const filt = [dir !== "both" ? dir : "", area ? `area code ${area}` : "", part ? `number has "${part}"` : "", kw ? `text has "${a.text_contains}"` : ""].filter(Boolean).join(", ");
      const scope = `${mine ? `your line ${prettyPhone(mine)}` : "your texts"} + shared lines`;
      if (!rows.length) return `No texts ${range}${filt ? ` (${filt})` : ""} on ${scope}.`;
      const [names, readMap] = await Promise.all([savedNames(db), readMapFor(db, me)]);
      const total = rows.length;
      const list = rows.slice(0, lim);
      const unread = rows.filter((m) => m.direction === "in" && String(m.at) > String(readMap[m.phone] || "")).length;
      const lines = list.map((m) => {
        const inbound = m.direction === "in";
        const status = inbound ? (String(m.at) > String(readMap[m.phone] || "") ? "UNREAD" : "read") : `sent${m.by ? ` by ${first(m.by)}` : ""}${m.kind === "cell" ? " (from cell)" : ""}`;
        const body = String(m.text || "").replace(/\s+/g, " ").trim();
        const pics = Array.isArray(m.media) && m.media.length ? `[${m.media.length} picture${m.media.length === 1 ? "" : "s"}]` : "";
        return `• ${nyStamp(m.at)} · ${inbound ? "⬅ in" : "➡ out"} · ${prettyPhone(m.phone)} · ${names.get(last10(m.phone)) || "unsaved"} · ${status}: ${[body ? `"${body.slice(0, 400)}"` : "", pics].filter(Boolean).join(" ") || "(empty)"}`;
      });
      return `${total} text${total === 1 ? "" : "s"} ${range} on ${scope}${filt ? ` (${filt})` : ""} — ${unread} unread incoming${total > list.length ? ` · newest ${list.length} shown` : ""}, newest first:\n${lines.join("\n")}`;
    }
    case "search_email": {
      const mb = mbox(me);
      const parts = [];
      if (a.query) parts.push(String(a.query).replace(/"/g, ""));
      if (a.from) parts.push(`from:${String(a.from).replace(/["\s]+/g, " ").trim().split(" ")[0]}`);
      if (a.with_attachments) parts.push("hasattachments:true");
      if (a.days) parts.push(`received>=${new Date(Date.now() - Number(a.days) * 86400000).toISOString().slice(0, 10)}`);
      if (!parts.length && !a.unread_only) fail("What should I search for?");
      const kql = parts.join(" ").replace(/\\/g, "");
      const SEL = "$select=id,subject,from,receivedDateTime,hasAttachments,bodyPreview,isRead";
      let list;
      if (!parts.length) {
        // Unread inbox ($search can't be combined with $filter, so this is its own query).
        const res = await msCall(() => graph("GET", `/users/${mb}/mailFolders/inbox/messages?$filter=isRead eq false&$top=50&${SEL}`));
        list = (res.value || []).sort((x, y) => String(y.receivedDateTime).localeCompare(String(x.receivedDateTime))).slice(0, 25);
        if (!list.length) return "No unread emails in your inbox.";
      } else {
        const res = await msCall(() => graph("GET", `/users/${mb}/messages?$search=${encodeURIComponent(`"${kql}"`)}&$top=${a.unread_only ? 40 : 15}&${SEL}`));
        list = (res.value || []).filter((m) => !a.unread_only || m.isRead === false).slice(0, 15);
        if (!list.length) return `No ${a.unread_only ? "unread " : ""}emails match "${kql}".`;
      }
      const out = [];
      for (const m of list) {
        let att = "";
        if (m.hasAttachments) { try { const as = (await graph("GET", `/users/${mb}/messages/${encodeURIComponent(m.id)}/attachments?$select=name,size,isInline`)).value || []; const names = as.filter((x) => !x.isInline).map((x) => `${x.name} (${fmtSize(x.size)})`); if (names.length) att = `\n   📎 ${names.join(", ")}`; } catch { /* skip */ } }
        out.push(`• ${m.isRead === false ? "📩 UNREAD · " : ""}${nyWhen(m.receivedDateTime)} — ${(m.from && m.from.emailAddress && (m.from.emailAddress.name || m.from.emailAddress.address)) || "—"}: ${m.subject || "(no subject)"}\n   ${String(m.bodyPreview || "").slice(0, 160)}${att}\n   id: ${m.id}`);
      }
      return `${list.length} email${list.length === 1 ? "" : "s"}:\n` + out.join("\n");
    }
    case "mark_email_read": {
      const mb = mbox(me);
      const read = a.read !== false;
      let ids = (a.ids || []).map((x) => String(x || "").trim()).filter(Boolean);
      if (!ids.length && a.all_unread) {
        let url = `/users/${mb}/mailFolders/inbox/messages?$filter=isRead eq false&$top=100&$select=id,from`;
        const all = [];
        for (let page = 0; url && page < 5; page++) { const res = await msCall(() => graph("GET", url)); all.push(...(res.value || [])); url = res["@odata.nextLink"] || null; }
        const q = norm(a.from);
        ids = all.filter((m) => !q || norm(`${(m.from && m.from.emailAddress && (m.from.emailAddress.name + " " + m.from.emailAddress.address)) || ""}`).includes(q)).map((m) => m.id);
        if (!ids.length) return `No unread emails${a.from ? ` from "${a.from}"` : ""} in your inbox.`;
      }
      if (!ids.length) fail("Which emails? Give ids from search_email, or all_unread=true.");
      let ok = 0, bad = 0;
      for (let i = 0; i < ids.length; i += 5) {
        const r = await Promise.allSettled(ids.slice(i, i + 5).map((id) => graph("PATCH", `/users/${mb}/messages/${encodeURIComponent(id)}`, { isRead: read })));
        r.forEach((x) => (x.status === "fulfilled" ? ok++ : bad++));
        if (ok === 0 && bad && r[0] && r[0].reason) await msCall(async () => { throw r[0].reason; });
      }
      return `Marked ${ok} email${ok === 1 ? "" : "s"} as ${read ? "read" : "unread"}${bad ? ` (${bad} couldn't be changed — they may have moved)` : ""}.`;
    }
    case "read_email": {
      const mb = mbox(me);
      const m = await msCall(() => graph("GET", `/users/${mb}/messages/${encodeURIComponent(a.id)}?$select=subject,from,toRecipients,ccRecipients,receivedDateTime,body,hasAttachments`));
      const who = (r) => (r || []).map((x) => x.emailAddress && (x.emailAddress.name ? `${x.emailAddress.name} <${x.emailAddress.address}>` : x.emailAddress.address)).join(", ");
      let att = "";
      if (m.hasAttachments) { const as = (await msCall(() => graph("GET", `/users/${mb}/messages/${encodeURIComponent(a.id)}/attachments?$select=id,name,size,isInline`))).value || []; const list = as.filter((x) => !x.isInline); if (list.length) att = `\nAttachments:\n${list.map((x) => `• ${x.name} (${fmtSize(x.size)}) — id: ${x.id}`).join("\n")}`; }
      const body = m.body && m.body.contentType === "html" ? htmlToText(m.body.content) : String((m.body && m.body.content) || "");
      return `Subject: ${m.subject || "(no subject)"}\nFrom: ${who([m.from])}\nTo: ${who(m.toRecipients)}${(m.ccRecipients || []).length ? `\nCc: ${who(m.ccRecipients)}` : ""}\nDate: ${nyWhen(m.receivedDateTime)}\n\n${body.slice(0, 6000)}${body.length > 6000 ? "\n…(cut off)" : ""}${att}`;
    }
    case "send_email": {
      if (a.confirmed !== true) fail("Not sent. Show the user the recipients, subject, body and attachments, get their OK, then call again with confirmed=true.");
      const mb = mbox(me);
      const to = await resolveEmails(db, a.to), cc = await resolveEmails(db, a.cc), bcc = await resolveEmails(db, a.bcc);
      if (!to.length) fail("Who should it go to?");
      const files = await msCall(() => gatherFiles(db, mb, a.attachments));
      const message = { subject: String(a.subject || ""), body: { contentType: "HTML", content: textToHtml(a.body) }, toRecipients: recip(to), ccRecipients: recip(cc), bccRecipients: recip(bcc) };
      await msCall(async () => {
        if (!files.length) return graph("POST", `/users/${mb}/sendMail`, { message, saveToSentItems: true });
        const draft = await graph("POST", `/users/${mb}/messages`, message);
        for (const f of files) await attachToDraft(mb, draft.id, f.name, f.buf, f.type);
        return graph("POST", `/users/${mb}/messages/${encodeURIComponent(draft.id)}/send`);
      });
      const names = (l) => l.map((r) => r.name || r.address).join(", ");
      return `Sent from ${me.email}: "${a.subject}" to ${names(to)}${cc.length ? `, cc ${names(cc)}` : ""}${bcc.length ? `, bcc ${names(bcc)}` : ""}${files.length ? ` — attached ${files.map((f) => f.name).join(", ")}` : ""}.`;
    }
    case "reply_email": {
      if (a.confirmed !== true) fail("Not sent. Show the user the reply (and any cc / attachments), get their OK, then call again with confirmed=true.");
      const mb = mbox(me);
      const cc = await resolveEmails(db, a.cc);
      // Gather attachments first, so a bad file name fails BEFORE a draft exists.
      const files = await msCall(() => gatherFiles(db, mb, a.attachments));
      let draftId = null;
      await msCall(async () => {
        const draft = await graph("POST", `/users/${mb}/messages/${encodeURIComponent(a.id)}/${a.reply_all ? "createReplyAll" : "createReply"}`, {});
        draftId = draft.id;
        const html = textToHtml(a.body) + "<br>" + ((draft.body && draft.body.content) || "");
        await graph("PATCH", `/users/${mb}/messages/${encodeURIComponent(draft.id)}`, { body: { contentType: "HTML", content: html }, ...(cc.length ? { ccRecipients: [...(draft.ccRecipients || []), ...recip(cc)] } : {}) });
        for (const f of files) await attachToDraft(mb, draft.id, f.name, f.buf, f.type);
        return graph("POST", `/users/${mb}/messages/${encodeURIComponent(draft.id)}/send`);
      }).catch(async (e) => {
        // Don't leave a half-built reply sitting in Drafts.
        if (draftId) { try { await graph("DELETE", `/users/${mb}/messages/${encodeURIComponent(draftId)}`); } catch { /* best effort */ } }
        throw e;
      });
      return `Reply${a.reply_all ? " (all)" : ""} sent from ${me.email}${cc.length ? `, cc ${cc.map((r) => r.name || r.address).join(", ")}` : ""}${files.length ? ` — attached ${files.map((f) => f.name).join(", ")}` : ""}.`;
    }
    case "recent_calls": {
      const days = Math.max(1, Math.min(90, Number(a.days) || 7));
      const limit = Math.max(1, Math.min(200, Number(a.limit) || 25));
      const dirW = ["inbound", "outbound", "missed"].includes(a.direction) ? a.direction : "all";
      const d10 = (x) => { const d = String(x || "").replace(/\D/g, ""); return d.length === 11 && d.startsWith("1") ? d.slice(1) : d; };
      const extOf = (v) => String(v || "").split("@")[0].trim();
      // Whose extension is whose (JIVETEL_CALL_EXT_<NAME>; Elie's may be the legacy un-suffixed var).
      const owners = {};
      for (const [k, v] of Object.entries(process.env)) { const m = /^JIVETEL_CALL_EXT_([A-Z0-9]+)$/.exec(k); if (m && extOf(v)) owners[extOf(v)] = m[1].toLowerCase(); }
      if (extOf(process.env.JIVETEL_CALL_EXT) && !owners[extOf(process.env.JIVETEL_CALL_EXT)]) owners[extOf(process.env.JIVETEL_CALL_EXT)] = "elie";
      const user = { id: me.id, email: me.email, user_metadata: { name: me.name } };
      const myExt = extOf(resolveCallPerson(user, me.name, me.name).creds.ext);
      const mine = (c) => { const e = extOf(c.ext); if (!e) return true; if (myExt && e === myExt) return true; return !owners[e]; };
      const { data: crow } = await db.from("app_settings").select("data").eq("id", "jivetel_calls").maybeSingle();
      const since = Date.now() - days * 86400000;
      let calls = (((crow && crow.data && crow.data.calls) || [])).filter((c) => c && c.at && Date.parse(c.at) >= since && mine(c));
      // Contacts directory: last-10-digits → name.
      const { data: crows } = await db.from("contacts").select("data");
      const book = new Map();
      (crows || []).map((r) => r.data).filter((c) => c && c.name).forEach((c) => {
        [...(c.phones || []).map((x) => x && x.number), c.phone].map(d10).filter((x) => x.length >= 10).forEach((n) => { if (!book.has(n)) book.set(n, c.name); });
      });
      if (a.number_or_contact) {
        const q = String(a.number_or_contact).trim();
        let want;
        if (d10(q).length >= 7) want = new Set([d10(q)]);
        else {
          const nq = norm(q);
          want = new Set([...book.entries()].filter(([, nm]) => norm(nm).includes(nq)).map(([n]) => n));
          if (!want.size) return `No contact named "${q}" in the directory — try their phone number.`;
        }
        calls = calls.filter((c) => [...want].some((n) => d10(c.phone) === n || (n.length < 10 && d10(c.phone).endsWith(n))));
      }
      const statusOf = (c) => (c.dir === "in" ? (c.vm ? "voicemail" : c.answered ? "answered" : "missed") : (c.answered ? "answered" : "no answer"));
      calls = calls.filter((c) => dirW === "all" || (dirW === "inbound" && c.dir === "in") || (dirW === "outbound" && c.dir === "out") || (dirW === "missed" && c.dir === "in" && (!c.answered || c.vm)));
      calls.sort((x, y) => String(y.at).localeCompare(String(x.at)));
      const total = calls.length;
      calls = calls.slice(0, limit);
      const who = myExt ? `ext ${myExt} + shared lines` : "all business lines — no extension on file for you";
      if (!calls.length) return `No ${dirW === "all" ? "" : dirW + " "}calls in the last ${days} day${days === 1 ? "" : "s"}${a.number_or_contact ? ` with ${a.number_or_contact}` : ""} (${who}).`;
      const when = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: NY, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      const dur = (s) => { s = Number(s) || 0; return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };
      const icon = { answered: "✅", missed: "❌", voicemail: "📼", "no answer": "⚪" };
      const lines = calls.map((c) => {
        const st = statusOf(c), num = e164(c.phone) || c.phone;
        const nm = book.get(d10(c.phone)) || "";
        const cnam = !nm && c.name && !/^\+?\d[\d\s()-]*$/.test(c.name) ? ` (caller ID: ${c.name})` : "";
        return `• ${when(c.at)} — ${c.dir === "in" ? "⬅ inbound" : "➡ outbound"} · ${nm ? `${nm} ${num}` : num}${cnam} · ${icon[st]} ${st}${c.talk ? ` · ${dur(c.talk)}` : ""}${c.ext ? ` · ext ${extOf(c.ext)}` : ""}`;
      });
      return `${total} call${total === 1 ? "" : "s"} in the last ${days} day${days === 1 ? "" : "s"} (${who})${total > calls.length ? `, newest ${calls.length} shown` : ""}:\n${lines.join("\n")}`;
    }
    case "read_file": {
      const mb = (a.email_id) ? mbox(me) : null;
      let src;
      if (a.email_id) src = { email_id: a.email_id, attachment: a.attachment || "" };
      else if (a.property && a.file) src = { property: a.property, file: a.file };
      else if (a.url) src = { url: a.url };
      else fail("Which file? Give an email_id (+ attachment), a property + file name, or a Goldstone file link.");
      const files = await msCall(() => gatherFiles(db, mb, [src]));
      const content = [];
      let pics = 0;
      for (const f of files.slice(0, 4)) {
        let r;
        try { r = await readFileContent(f, { pages: a.pages }); }
        catch (e) { r = { text: `Couldn't open it (${e.message}). It may be password-protected or damaged.`, images: [] }; }
        const imgs = r.images.slice(0, Math.max(0, 6 - pics)); pics += imgs.length;
        content.push({ type: "text", text: `📄 ${f.name} (${fmtSize(f.buf.length)})\n${r.text}` });
        for (const im of imgs) content.push({ type: "image", data: im.data, mimeType: im.mimeType });
      }
      if (files.length > 4) content.push({ type: "text", text: `(${files.length - 4} more attachment${files.length - 4 === 1 ? "" : "s"} not opened — name the one you want.)` });
      return { content };
    }
    case "list_property_files": {
      const f = await propFolder(db, a.property);
      const fid = await msCall(() => subFolder(f, a.folder, false));
      const res = await msCall(() => graph("GET", `/drives/${encodeURIComponent(f.driveId)}/items/${encodeURIComponent(fid)}/children?$top=200&$select=id,name,size,folder,lastModifiedDateTime`));
      const kids = (res.value || []).sort((x, y) => (!!y.folder - !!x.folder) || String(y.lastModifiedDateTime).localeCompare(String(x.lastModifiedDateTime)));
      if (!kids.length) return `${addrOf(f.p)}${a.folder ? ` / ${a.folder}` : ""}: the folder is empty.`;
      return `${addrOf(f.p)}${a.folder ? ` / ${a.folder}` : ""} (${kids.length}):\n` + kids.slice(0, 100).map((k) => k.folder ? `📁 ${k.name} (${k.folder.childCount || 0} items)` : `• ${k.name} — ${fmtSize(k.size)} · ${fmtDate(k.lastModifiedDateTime)}`).join("\n");
    }
    case "save_email_attachment": {
      const mb = mbox(me);
      const f = await propFolder(db, a.property);
      const all = !a.attachment || /^all$/i.test(String(a.attachment));
      const files = await msCall(() => gatherFiles(db, mb, [{ email_id: a.email_id, attachment: all ? "" : a.attachment }]));
      const fid = await msCall(() => subFolder(f, a.folder, true));
      const saved = [];
      for (const x of files) { const it = await msCall(() => uploadToFolder(f.driveId, fid, x.name, x.buf)); saved.push(it.name || x.name); }
      return `Saved to ${addrOf(f.p)}${a.folder ? ` / ${a.folder}` : ""}: ${saved.join(", ")}.`;
    }
    case "mortgage_status": {
      const d = new Date();
      const ym = /^\d{4}-\d{2}$/.test(String(a.month || "")) ? a.month : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const rows = await loadOffice(db);
      const t = (rows.find((r) => r.t.autoId === `mortgages:${ym}`) || {}).t;
      if (!t) return `No mortgage checklist for ${ym} yet (it's created on the 1st when Elie or Esti opens the app).`;
      const subs = subsOf(t);
      const unpaid = subs.filter((s) => !s.done), paid = subs.filter((s) => s.done);
      // What the app's auto-tick would see: a flip's balance-sheet debt-service line this month.
      const props = (await loadProps(db).catch(() => [])).map((x) => x.p);
      const ymOfDate = (v) => { const m = String(v || "").match(/^(\d{4})-(\d{2})/); if (m) return `${m[1]}-${m[2]}`; const dd = new Date(v); return isNaN(dd) ? "" : dd.toISOString().slice(0, 7); };
      const sheetPaid = (s) => {
        if (!s.ref || s.ref.kind !== "prop") return "";
        const p = props.find((x) => String(x.id) === String(s.ref.id));
        if (!p) return " [property not found]";
        const hit = [...(p.qbDebtTxns || []), ...(p.qbDebtCustom || [])].find((x) => x && ymOfDate(x.date) === ym);
        return hit ? ` [balance sheet shows ${String(hit.date).slice(0, 10)} $${Math.abs(Number(hit.amount) || 0).toLocaleString("en-US")}]` : "";
      };
      return [`${t.text}: ${paid.length} of ${subs.length} paid${t.urgent ? " · 🚨 urgent" : ""}`,
        `QuickBooks auto-check last ran: ${t.qbCheckedAt ? new Date(t.qbCheckedAt).toLocaleString("en-US", { timeZone: "America/New_York" }) : "never this month"}`,
        `Not paid yet (${unpaid.length}):`, ...(unpaid.length ? unpaid.map((s) => `• ${s.text}${s.group ? ` (${s.group === "Rentals" ? "rental" : "flip"})` : ""}${s.late ? " — LATE" : ""}${s.ref ? "" : " [no link to the property]"}${sheetPaid(s)}`) : ["• none"]),
        `Paid (${paid.length}):`, ...paid.map((s) => `• ${s.text}${s.qb ? ` — QuickBooks ${s.qb.date || ""} $${Number(s.qb.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : s.doneBy ? ` — ticked by ${first(s.doneBy)}` : ""}`)].join("\n");
    }
    default:
      fail(`Unknown tool: ${name}`);
  }
  return "";
}
export { UserError, saveProp, locate, findTask, smsFor, showStartMs, fail, norm, addrOf, first, nowIso, newId, fmtDate, nyWhen, nyDate, loadProps, loadTeam, findProp, resolvePerson, propFolder, subFolder, msCall, isDone, showingMatchesProperty };
