// 🤖 Claude connector — the actions (MCP tools) a teammate can run by talking
// to Claude (Elie 10/13/26). Everything runs AS the signed-in teammate: tasks
// show them as creator, texts go out from their own line, notifications name them.
// Data lives where the app keeps it: properties.data (tasks, messages),
// office_tasks (Company tasks), contacts, users. Writes are read-modify-write
// of one row; the app's realtime sync + three-way merge picks them up.
import { admin } from "./mcpAuth.js";
import { notifyFanout } from "./notify.js";
import { storeSms, e164, firstName, sameFirst, checkOutreach, resolveSender } from "./jivetel.js";
import { fetchShowings } from "./showings.js";
import { graph, uploadToFolder, textToHtml, htmlToText } from "./msGraph.js";

const OFFICE = "__office_task__";
const isDone = (t) => t && (t.status === "Completed" || t.status === "N/A");
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const addrOf = (p) => `${p.address || "Property"}${p.city ? `, ${p.city}` : ""}`;
const nowIso = () => new Date().toISOString();
const newId = () => Date.now() + Math.floor(Math.random() * 1000);
const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }); } catch { return ""; } };
const first = (n) => String(n || "").split(" ")[0];
const COMPANY = ["company", "office", "company tasks", "company task", "general"];

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
function showingMatchesProperty(text, p) {
  const a = `${p.address || ""} ${p.city || ""}`;
  const hn = qbHouseNum(a), thn = qbHouseNum(text || "");
  if (!hn || !thn || hn !== thn) return false;
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
  if (me.role !== "admin") {
    const mine = new Set(rows.filter((x) => String(x.direction).startsWith("out") && sameFirst(x.by, me.name)).map((x) => x.phone));
    rows = rows.filter((x) => mine.has(x.phone));
  }
  return rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// ── Outlook + OneDrive helpers (the connected teammate's OWN mailbox only) ───
const mbox = (me) => { if (!me.email || !/@/.test(me.email)) fail("Your Goldstone login has no email address on file."); return encodeURIComponent(me.email); };
async function msCall(fn) {
  try { return await fn(); } catch (e) {
    if (e instanceof UserError) throw e;
    if (e.setup) fail(`Email/files aren't switched on yet: ${e.message}`);
    if (e.permission) fail("Microsoft hasn't given the Goldstone app permission for this yet. Elie needs to approve it in Microsoft (Azure → App registrations → API permissions → Mail.Send, Mail.ReadWrite, Files.ReadWrite.All → Grant admin consent).");
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
  const CH = 3 * 1024 * 1024;
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
      const res = await graph("GET", `/drives/${encodeURIComponent(f.driveId)}/items/${encodeURIComponent(f.id)}/search(q='${encodeURIComponent(String(it.file).replace(/'/g, "''"))}')?$select=id,name,size,file`);
      const files = (res.value || []).filter((x) => x.file);
      const hit = files.find((x) => norm(x.name) === norm(it.file)) || files[0];
      if (!hit) fail(`No file like "${it.file}" in ${addrOf(f.p)}'s folder.`);
      const buf = await readBytes(await graph("GET", `/drives/${encodeURIComponent(f.driveId)}/items/${encodeURIComponent(hit.id)}/content`, null, { raw: true }));
      out.push({ name: hit.name, buf, type: (hit.file && hit.file.mimeType) || "application/octet-stream" }); total += buf.length;
    } else if (it && it.email_id) {
      const atts = (await graph("GET", `/users/${mb}/messages/${encodeURIComponent(it.email_id)}/attachments?$select=id,name,contentType,size,isInline`)).value || [];
      const pick = atts.filter((x) => !x.isInline && (!it.attachment || x.id === it.attachment || norm(x.name).includes(norm(it.attachment))));
      if (!pick.length) fail(`That email has no attachment like "${it.attachment || ""}".`);
      for (const x of pick) {
        const buf = await readBytes(await graph("GET", `/users/${mb}/messages/${encodeURIComponent(it.email_id)}/attachments/${encodeURIComponent(x.id)}/$value`, null, { raw: true }));
        out.push({ name: x.name, buf, type: x.contentType }); total += buf.length;
      }
    } else fail('Each attachment needs {property, file} or {email_id, attachment}.');
    if (total > 30 * 1024 * 1024) fail("Attachments are over 30 MB — send a link instead.");
  }
  return out;
}

// ── Tools ────────────────────────────────────────────────────────────────────
const S = (props, required = []) => ({ type: "object", properties: props, required, additionalProperties: false });
const str = (d) => ({ type: "string", description: d });
const P = str('Property: part of the address (e.g. "19 Orchard"), or "company" for Company tasks.');
const TK = str('Task: its #id or words from its name.');

export const TOOLS = [
  { name: "find_properties", title: "Find properties", description: "List the team's properties (address, status, open-task count). Optional search text and/or status filter (Under Contract, Purchased, Under Construction, On Market, In Closing, Sold, Rental).",
    inputSchema: S({ query: str("Part of an address or town (optional)."), status: str("Only this status (optional).") }), annotations: { readOnlyHint: true } },
  { name: "get_property", title: "Property details", description: "One property: status, address, its open tasks (with checklists) and the latest team chat messages.",
    inputSchema: S({ property: P }, ["property"]), annotations: { readOnlyHint: true } },
  { name: "list_tasks", title: "List tasks", description: 'Tasks across all properties and Company tasks. who = "me" (default), a teammate\'s name, "everyone" or "unassigned". status = open (default) | done | all.',
    inputSchema: S({ who: str('Whose tasks (default "me").'), property: str("Limit to one property (optional)."), status: { type: "string", enum: ["open", "done", "all"] }, urgent_only: { type: "boolean" } }), annotations: { readOnlyHint: true } },
  { name: "add_task", title: "Add a task", description: "Create a task on a property (or Company tasks). Optional assignee (owner), delegate (who does the work), urgent flag and checklist items. The people involved get a notification.",
    inputSchema: S({ property: P, text: str("What needs to be done."), assignee: str("Owner — teammate name (default: me)."), delegate: str("Teammate doing the work (optional)."), urgent: { type: "boolean" }, checklist: { type: "array", items: { type: "string" }, description: "Checklist sub-items (optional)." } }, ["property", "text"]) },
  { name: "update_task", title: "Update a task", description: "Change a task: complete or reopen it, mark/unmark urgent, change owner or delegate, rename, or add checklist items.",
    inputSchema: S({ property: P, task: TK, complete: { type: "boolean" }, reopen: { type: "boolean" }, urgent: { type: "boolean" }, assignee: str("New owner (optional)."), delegate: str('New delegate, or "none" to clear (optional).'), rename: str("New task name (optional)."), add_checklist_items: { type: "array", items: { type: "string" } } }, ["property", "task"]) },
  { name: "tick_checklist_item", title: "Tick a checklist item", description: "Tick (or untick) one checklist item inside a task. Ticking the last item completes the task automatically.",
    inputSchema: S({ property: P, task: TK, item: str("Words from the checklist item."), done: { type: "boolean", description: "true = tick (default), false = untick." } }, ["property", "task", "item"]) },
  { name: "post_message", title: "Post a team message", description: "Post a message in the team chat of a property, or in a task's conversation (give task). notify = teammates to @-mention and push.",
    inputSchema: S({ property: P, text: str("The message."), task: str("Task #id or name — post in that task's conversation instead (optional; required for Company tasks)."), notify: { type: "array", items: { type: "string" }, description: "Teammates to notify (optional)." } }, ["property", "text"]) },
  { name: "find_contact", title: "Find a contact", description: "Search the contacts directory by name, company, trade or phone. Returns phones and email.",
    inputSchema: S({ query: str("Name, company, trade or number.") }, ["query"]), annotations: { readOnlyHint: true } },
  { name: "send_text", title: "Send a text message", description: "Send an SMS from the signed-in teammate's own business line. ALWAYS show the user the exact recipient and message and get an explicit yes first; then call with confirmed=true. `to` = a phone number or a contact's name.",
    inputSchema: S({ to: str("Phone number or contact name."), message: str("Exact text to send."), property: str("Property this is about (optional — files the conversation)."), confirmed: { type: "boolean", description: "Must be true — only after the user approved this exact text." } }, ["to", "message", "confirmed"]), annotations: { destructiveHint: false, openWorldHint: true } },
  { name: "list_showings", title: "Showings", description: "ShowingTime showings (and inspections/appraisals) for a day — today by default — with the property, agent, agent phone, and whether the agent was texted AFTER the showing to ask how it went (and whether they replied). Use it for 'how many showings today', 'which agents haven't I followed up with'.",
    inputSchema: S({ date: str('today (default), tomorrow, yesterday, or YYYY-MM-DD.'), days: { type: "integer", minimum: 1, maximum: 14, description: "How many days starting at date (default 1)." }, property: str("Only showings for this property (optional).") }), annotations: { readOnlyHint: true } },
  { name: "get_texts", title: "Read a text conversation", description: "The recent text messages (both directions) with one phone number or contact name, newest last.",
    inputSchema: S({ with: str("Phone number or contact name."), limit: { type: "integer", minimum: 1, maximum: 50, description: "How many messages (default 20)." } }, ["with"]), annotations: { readOnlyHint: true } },
  { name: "search_email", title: "Search my email", description: "Search the signed-in teammate's own Outlook mailbox. Returns subject, sender, date, attachment names and an id (for read_email / reply_email / attachments).",
    inputSchema: S({ query: str("Words to look for (address, name, subject…)."), from: str("Sender name or email (optional)."), days: { type: "integer", minimum: 1, maximum: 365, description: "Only the last N days (optional)." }, with_attachments: { type: "boolean", description: "Only emails with attachments." } }), annotations: { readOnlyHint: true } },
  { name: "read_email", title: "Read an email", description: "Full text of one email from search_email, with its attachments (ids, names, sizes).",
    inputSchema: S({ id: str("The email id from search_email.") }, ["id"]), annotations: { readOnlyHint: true } },
  { name: "send_email", title: "Send an email", description: "Send an email from the signed-in teammate's own Outlook. to/cc/bcc take email addresses or names of teammates/contacts. Attachments can come from a property's OneDrive folder ({property, file}) or another email ({email_id, attachment}). ALWAYS show the user the recipients, subject, body and attachments and get an explicit yes first; then call with confirmed=true.",
    inputSchema: S({ to: { type: "array", items: { type: "string" } }, cc: { type: "array", items: { type: "string" } }, bcc: { type: "array", items: { type: "string" } }, subject: str("Subject line."), body: str("Email body (plain text; line breaks kept)."), attachments: { type: "array", items: { type: "object", properties: { property: { type: "string" }, file: { type: "string" }, email_id: { type: "string" }, attachment: { type: "string" } } } }, confirmed: { type: "boolean", description: "Must be true — only after the user approved this exact email." } }, ["to", "subject", "body", "confirmed"]), annotations: { destructiveHint: false, openWorldHint: true } },
  { name: "reply_email", title: "Reply to an email", description: "Reply (or reply-all) to an email from search_email, from the teammate's own Outlook. Optional extra cc. ALWAYS show the user the reply and get a yes first; then confirmed=true.",
    inputSchema: S({ id: str("The email id."), body: str("Reply text."), reply_all: { type: "boolean" }, cc: { type: "array", items: { type: "string" } }, confirmed: { type: "boolean" } }, ["id", "body", "confirmed"]), annotations: { destructiveHint: false, openWorldHint: true } },
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
        ...(msgs.length ? msgs.map((m) => `• ${first(m.author)} (${fmtDate(m.at)}): ${String(m.text || "").slice(0, 300)}`) : ["• no messages"]),
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
      const msg = { id: newId(), author: me.name, text, at: nowIso(), readBy: [me.name], ...(mentions.length ? { mentions } : {}), via: "claude" };
      const loc = await locate(db, a.property);
      if (a.task) {
        const t0 = findTask(loc.tasks, a.task, loc.label);
        await loc.update(t0.id, (t) => ({ ...t, messages: [...(t.messages || []), msg] }));
        if (mentions.length) await ping(db, me, mentions, { title: `Task: ${t0.text}`, body: `${me.name}: ${text}`, url: goto(loc.pid, t0.id), tag: `task-${t0.id}` });
        return `Posted in "${t0.text}" (${loc.label})${mentions.length ? ` and notified ${mentions.map(first).join(", ")}` : ""}.`;
      }
      if (!loc.addMsg) fail("For Company tasks, say which task to post the message in.");
      await loc.addMsg(msg);
      if (mentions.length) await ping(db, me, mentions, { title: loc.label, body: `${me.name}: ${text}`, url: `/?goto=chat:${loc.pid}`, tag: `chat-${loc.pid}` });
      return `Posted in the ${loc.label} team chat${mentions.length ? ` and notified ${mentions.map(first).join(", ")}` : ""}.`;
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
      const message = String(a.message || "").trim();
      if (!message) fail("The message is empty.");
      let to = String(a.to || "").trim(), toName = "";
      if (String(to).replace(/\D/g, "").length < 10) {
        const q = norm(to);
        const { data } = await db.from("contacts").select("data");
        const hits = (data || []).map((r) => r.data).filter((c) => c && norm(c.name).includes(q));
        if (!hits.length) fail(`No contact named "${a.to}". Give a phone number instead.`);
        if (hits.length > 1) fail(`"${a.to}" matches ${hits.length} contacts: ${hits.slice(0, 6).map((c) => c.name).join(", ")}. Be more specific.`);
        const c = hits[0];
        const num = ((c.phones || []).find((p) => /mobile|cell/i.test(p.label || "")) || (c.phones || [])[0] || {}).number || c.phone;
        if (!num) fail(`${c.name} has no phone number on file.`);
        to = num; toName = c.name;
      }
      const user = { id: me.id, email: me.email, user_metadata: { name: me.name } };
      const { person, from, token } = resolveSender(user, null, me.name);
      if (!from || !token) fail(`Texting isn't connected for ${person || me.name} yet.`);
      const gate = await checkOutreach(to, me.name, "text");
      if (!gate.allowed) fail(`This is ${first(gate.owner)}'s contact — ${first(gate.owner)} got an approval request. Once approved you can text them.`);
      const body = { to: e164(to), from: e164(from), message };
      const r = await fetch("https://jivetel-txt.jivetel.com/api/send", { method: "POST", headers: { "Content-Type": "application/json", Authorization: token.includes(" ") ? token : `Bearer ${token}` }, body: JSON.stringify(body) });
      const txt = await r.text();
      if (!r.ok) fail(`The text didn't go through (Jivetel ${r.status}).`);
      let d = null; try { d = JSON.parse(txt); } catch { /* ok */ }
      if (d && d.status === false) fail(d.msg || "Jivetel rejected the message.");
      await storeSms({ id: String(d?.id || `out-${Date.now()}`), phone: body.to, direction: "out", text: message, by: me.name, from: body.from, at: nowIso(), status: "sent", via: "claude", ...(a.property ? { prop: String(a.property).slice(0, 80) } : {}) }).catch(() => {});
      return `Sent from ${first(person || me.name)}'s line to ${toName ? `${toName} (${body.to})` : body.to}: "${message}"`;
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
      let phone = String(a.with || "").trim(), who = "";
      if (phone.replace(/\D/g, "").length < 10) {
        const q = norm(phone);
        const { data } = await db.from("contacts").select("data");
        const hits = (data || []).map((r) => r.data).filter((c) => c && norm(c.name).includes(q));
        if (!hits.length) fail(`No contact named "${a.with}". Give a phone number instead.`);
        if (hits.length > 1) fail(`"${a.with}" matches ${hits.length} contacts: ${hits.slice(0, 6).map((c) => c.name).join(", ")}.`);
        const c = hits[0];
        phone = ((c.phones || []).find((p) => /mobile|cell/i.test(p.label || "")) || (c.phones || [])[0] || {}).number || c.phone || "";
        if (!phone) fail(`${c.name} has no phone number on file.`);
        who = c.name;
      }
      const rows = (await smsFor(db, [phone], me)).filter((m) => m.kind !== "call");
      if (!rows.length) return `No texts with ${who || e164(phone)}${me.role !== "admin" ? " that you're part of" : ""}.`;
      const lim = Math.max(1, Math.min(50, Number(a.limit) || 20));
      const shown = rows.slice(0, lim).reverse();
      return `Texts with ${who ? `${who} (${e164(phone)})` : e164(phone)} — last ${shown.length}:\n` + shown.map((m) => `• ${nyWhen(m.at)} ${m.direction === "in" ? "← them" : `→ ${first(m.by) || "us"}${m.kind === "cell" ? " (from cell)" : ""}`}: ${String(m.text || (m.media ? "[picture]" : "")).slice(0, 400)}`).join("\n");
    }
    case "search_email": {
      const mb = mbox(me);
      const parts = [];
      if (a.query) parts.push(String(a.query).replace(/"/g, ""));
      if (a.from) parts.push(`from:${String(a.from).replace(/["\s]+/g, " ").trim().split(" ")[0]}`);
      if (a.with_attachments) parts.push("hasattachments:true");
      if (a.days) parts.push(`received>=${new Date(Date.now() - Number(a.days) * 86400000).toISOString().slice(0, 10)}`);
      if (!parts.length) fail("What should I search for?");
      const kql = parts.join(" ").replace(/\\/g, "");
      const res = await msCall(() => graph("GET", `/users/${mb}/messages?$search=${encodeURIComponent(`"${kql}"`)}&$top=15&$select=id,subject,from,receivedDateTime,hasAttachments,bodyPreview`));
      const list = res.value || [];
      if (!list.length) return `No emails match "${kql}".`;
      const out = [];
      for (const m of list) {
        let att = "";
        if (m.hasAttachments) { try { const as = (await graph("GET", `/users/${mb}/messages/${encodeURIComponent(m.id)}/attachments?$select=name,size,isInline`)).value || []; const names = as.filter((x) => !x.isInline).map((x) => `${x.name} (${fmtSize(x.size)})`); if (names.length) att = `\n   📎 ${names.join(", ")}`; } catch { /* skip */ } }
        out.push(`• ${nyWhen(m.receivedDateTime)} — ${(m.from && m.from.emailAddress && (m.from.emailAddress.name || m.from.emailAddress.address)) || "—"}: ${m.subject || "(no subject)"}\n   ${String(m.bodyPreview || "").slice(0, 160)}${att}\n   id: ${m.id}`);
      }
      return `${list.length} email${list.length === 1 ? "" : "s"}:\n` + out.join("\n");
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
      if (a.confirmed !== true) fail("Not sent. Show the user the reply, get their OK, then call again with confirmed=true.");
      const mb = mbox(me);
      const cc = await resolveEmails(db, a.cc);
      await msCall(async () => {
        const draft = await graph("POST", `/users/${mb}/messages/${encodeURIComponent(a.id)}/${a.reply_all ? "createReplyAll" : "createReply"}`, {});
        const html = textToHtml(a.body) + "<br>" + ((draft.body && draft.body.content) || "");
        await graph("PATCH", `/users/${mb}/messages/${encodeURIComponent(draft.id)}`, { body: { contentType: "HTML", content: html }, ...(cc.length ? { ccRecipients: [...(draft.ccRecipients || []), ...recip(cc)] } : {}) });
        return graph("POST", `/users/${mb}/messages/${encodeURIComponent(draft.id)}/send`);
      });
      return `Reply${a.reply_all ? " (all)" : ""} sent from ${me.email}${cc.length ? `, cc ${cc.map((r) => r.name || r.address).join(", ")}` : ""}.`;
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
      return [`${t.text}: ${paid.length} of ${subs.length} paid${t.urgent ? " · 🚨 urgent" : ""}`,
        `Not paid yet (${unpaid.length}):`, ...(unpaid.length ? unpaid.map((s) => `• ${s.text}${s.group ? ` (${s.group === "Rentals" ? "rental" : "flip"})` : ""}${s.late ? " — LATE" : ""}`) : ["• none"]),
        `Paid (${paid.length}):`, ...paid.map((s) => `• ${s.text}${s.qb ? ` — QuickBooks ${s.qb.date || ""} $${Number(s.qb.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : s.doneBy ? ` — ticked by ${first(s.doneBy)}` : ""}`)].join("\n");
    }
    default:
      fail(`Unknown tool: ${name}`);
  }
  return "";
}
export { UserError };
