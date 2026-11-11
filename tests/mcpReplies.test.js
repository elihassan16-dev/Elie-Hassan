// node --test tests/ — the connector's threaded replies (post_message /
// message_contractor reply_to) and the message ids on the read tools, end to
// end against an in-memory FAKE Supabase (global fetch is stubbed).
import { test, before } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

// ── tiny in-memory PostgREST ─────────────────────────────────────────────────
const T = {
  users: [
    { id: "u1", name: "Elie Hassan", email: "elie@x.com", role: "admin" },
    { id: "u2", name: "Estie Ungar", email: "esti@x.com", role: "member" },
    { id: "u3", name: "Moshe Groner", email: "moshe@x.com", role: "member" },
  ],
  properties: [{ id: "row1", data: {
    id: 501, address: "417 Lakeview Ter", city: "Pemberton", status: "Under Construction",
    messages: [
      { id: 1001, author: "Estie Ungar", text: "do you have the inspectors contact info - the one who did the fire co? I need it for the township today please", at: "2026-11-10T14:00:00Z", readBy: ["Estie Ungar"] },
      { id: 1002, author: "Elie Hassan", text: "Yes i have CO we dont need another", at: "2026-11-10T14:05:00Z", readBy: ["Elie Hassan"], replyToId: 1001, replyTo: { id: 1001, author: "Estie Ungar", text: "do you have the inspectors contact info" } },
      { id: 1003, author: "Moshe Groner", text: "", attachment: { kind: "image", url: "https://x/p.jpg" }, at: "2026-11-10T15:00:00Z", readBy: [] , showingKey: "sk1", showingLabel: "Showing Nov 9" },
    ],
    tasks: [{ id: 77, text: "Fire CO inspection", status: "Not Started", assignee: "Estie Ungar", messages: [
      { id: 2001, author: "Estie Ungar", text: "Inspector is coming Thursday 9am", at: "2026-11-10T16:00:00Z", readBy: ["Estie Ungar"] },
    ] }],
  } }],
  office_messages: [{ id: "3001", data: { id: 3001, author: "Moshe Groner", text: "Who has the van keys?", at: "2026-11-10T17:00:00Z", readBy: ["Moshe Groner"] } }],
  office_tasks: [{ id: "ot1", data: { id: 88, text: "Renew insurance", status: "Not Started", messages: [{ id: 4001, author: "Estie Ungar", text: "Quote came in at $4,200", at: "2026-11-10T18:00:00Z", readBy: [] }] } }],
  contractor_jobs: [{ id: "j1", data: { id: "j1", orgId: "o1", propertyId: 501, propertyAddress: "417 Lakeview Ter", title: "Kitchen", status: "active" } }],
  contractor_orgs: [{ id: "o1", data: { id: "o1", name: "MCD Builds LLC" } }],
  contractor_messages: [{ id: "5001", org_id: "o1", data: { id: 5001, jobId: "j1", orgId: "o1", author: "Mendel", side: "contractor", text: "Water heater is leaking — need approval to replace today", at: "2026-11-10T19:00:00Z", readBy: [], taskRefText: "Plumbing" } }],
  push_subscriptions: [], app_settings: [], contacts: [],
};
const parse = (u) => {
  const url = new URL(u); const table = url.pathname.split("/").pop();
  const filters = [...url.searchParams.entries()].filter(([k]) => !["select", "limit", "order", "on_conflict"].includes(k));
  return { table, filters };
};
const match = (row, filters) => filters.every(([k, v]) => {
  const val = String(row[k] ?? (row.data && row.data[k]) ?? "");
  if (v.startsWith("eq.")) return val === decodeURIComponent(v.slice(3));
  if (v.startsWith("in.")) return v.slice(4, -1).split(",").map((x) => x.replace(/^"|"$/g, "")).includes(val);
  return true;
});
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const pushes = [];
before(() => {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url), method = (opts.method || "GET").toUpperCase();
    if (!u.includes("/rest/v1/")) { pushes.push(u); return json({}); }
    const { table, filters } = parse(u);
    const rows = T[table] || (T[table] = []);
    if (method === "GET") return json(rows.filter((r) => match(r, filters)));
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (method === "POST") { (Array.isArray(body) ? body : [body]).forEach((b) => { const i = rows.findIndex((r) => String(r.id) === String(b.id)); if (i >= 0) rows[i] = { ...rows[i], ...b }; else rows.push(b); }); return json([], 201); }
    if (method === "PATCH") { rows.filter((r) => match(r, filters)).forEach((r) => Object.assign(r, body)); return json([]); }
    return json([]);
  };
});
const elie = { id: "u1", name: "Elie Hassan", email: "elie@x.com", role: "admin" };
const run = async (name, args) => {
  const [{ runTool }, { runMore }, { runMore2 }, { MORE_TOOLS }, { MORE2_TOOLS }] = await Promise.all([import("../lib/mcpTools.js"), import("../lib/mcpMore.js"), import("../lib/mcpMore2.js"), import("../lib/mcpMore.js"), import("../lib/mcpMore2.js")]);
  const { admin } = await import("../lib/mcpAuth.js");
  if (MORE2_TOOLS.some((t) => t.name === name)) return runMore2(admin(), name, args, elie);
  if (MORE_TOOLS.some((t) => t.name === name)) return runMore(admin(), name, args, elie);
  return runTool(name, args, elie);
};
const prop = () => T.properties[0].data;
const lastMsg = () => prop().messages.at(-1);

test("read_chat lists ids, replies, task + contractor messages", async () => {
  const out = await run("read_chat", { property: "417 Lakeview" });
  assert.match(out, /\[id 1001\] .* Estie: do you have the inspectors contact info/);
  assert.match(out, /\[id 1002\] .* Elie: ↩ \(replying to Estie: "do you have the inspectors contact info"\) Yes i have CO/);
  assert.match(out, /\[id 1003\] .* Moshe \[showing: Showing Nov 9\]: 📷 Photo sent/);
  assert.match(out, /\[id 2001\] .* Estie \[task "Fire CO inspection"\]: Inspector is coming/);
  assert.match(out, /\[id ctr-5001\] .* Mendel \[contractor chat, contractor — Kitchen\]: Water heater/);
  const office = await run("read_chat", { property: "office" });
  assert.match(office, /\[id 3001\] .* Moshe: Who has the van keys\?/);
  assert.match(office, /\[id 4001\] .* \[task "Renew insurance"\]/);
  const task = await run("read_chat", { property: "417 Lakeview", task: "Fire CO" });
  assert.match(task, /^"Fire CO inspection" .*\n• \[id 2001\]/);
  const gp = await run("get_property", { property: "417 Lakeview" });
  assert.match(gp, /\[id 1001\]/);
});

test("post_message reply_to → same fields as the app's ↩ Reply, original sender notified", async () => {
  const out = await run("post_message", { property: "417 Lakeview", text: "Sending it now", reply_to: "1001" });
  assert.match(out, /as a reply to Estie \("do you have the inspectors contact info/);
  assert.match(out, /notified Estie/);
  const m = lastMsg();
  assert.equal(m.text, "Sending it now");
  assert.equal(m.replyToId, 1001); // same type as the original id (the app's thread chain compares ids)
  assert.deepEqual(m.replyTo, { id: 1001, author: "Estie Ungar", text: prop().messages[0].text.slice(0, 140), taskText: null });
  assert.ok(m.replyTo.text.length <= 140);
  assert.deepEqual(m.mentions, ["Estie Ungar"]);
  assert.equal(m.author, "Elie Hassan");
});

test("reply to a reply chains into the same thread", async () => {
  await run("post_message", { property: "417 Lakeview", text: "ok thanks", reply_to: "#1002" });
  const m = lastMsg();
  assert.equal(m.replyToId, 1002);
  assert.equal(m.replyTo.author, "Elie Hassan");
  assert.equal(m.replyTo.text, "Yes i have CO we dont need another");
  assert.ok(!m.mentions, "replying to my own message doesn't tag me");
  // Thread root = 1001 (the app's buildMessageThreads walks replyToId).
  const byId = new Map(prop().messages.map((x) => [x.id, x]));
  let cur = m; while (cur.replyToId && byId.has(cur.replyToId)) cur = byId.get(cur.replyToId);
  assert.equal(cur.id, 1001);
});

test("reply to an attachment / showing message keeps the showing thread and quotes the attachment label", async () => {
  await run("post_message", { property: "417 Lakeview", text: "Nice photo", reply_to: "1003" });
  const m = lastMsg();
  assert.equal(m.replyTo.text, "📷 Photo sent");
  assert.equal(m.showingKey, "sk1");
  assert.equal(m.showingLabel, "Showing Nov 9");
});

test("reply to a task message posts INTO that task's conversation with taskText", async () => {
  const before = prop().messages.length;
  const out = await run("post_message", { property: "417 Lakeview", text: "I'll be there", reply_to: "2001" });
  assert.match(out, /^Posted in "Fire CO inspection"/);
  assert.equal(prop().messages.length, before);
  const m = prop().tasks[0].messages.at(-1);
  assert.equal(m.replyToId, 2001);
  assert.deepEqual(m.replyTo, { id: 2001, author: "Estie Ungar", text: "Inspector is coming Thursday 9am", taskText: "Fire CO inspection" });
});

test("Office Chat + Company-task replies", async () => {
  await run("post_message", { property: "office", text: "I do", reply_to: "3001" });
  const om = T.office_messages.at(-1).data;
  assert.equal(om.replyToId, 3001);
  assert.equal(om.replyTo.author, "Moshe Groner");
  await run("post_message", { property: "office", text: "Approve it", reply_to: "4001" });
  const tm = T.office_tasks[0].data.messages.at(-1);
  assert.equal(tm.replyToId, 4001);
  assert.equal(tm.replyTo.taskText, "Renew insurance");
});

test("missing reply_to → normal message, and the result says so", async () => {
  const out = await run("post_message", { property: "417 Lakeview", text: "general note", reply_to: "999999" });
  assert.match(out, /couldn't find message 999999 .* posted as a normal message, not a reply/);
  const m = lastMsg();
  assert.equal(m.text, "general note");
  assert.ok(!m.replyTo && !m.replyToId);
  const plain = await run("post_message", { property: "417 Lakeview", text: "no reply here" });
  assert.match(plain, /^Posted in the 417 Lakeview Ter, Pemberton team chat\.$/);
});

test("a contractor message id sends post_message to message_contractor", async () => {
  await assert.rejects(() => run("post_message", { property: "417 Lakeview", text: "x", reply_to: "ctr-5001" }), /use message_contractor|reply with message_contractor/);
});

test("message_contractor reply_to → portal reply shape, job found from the message", async () => {
  await assert.rejects(() => run("message_contractor", { text: "Approved, go ahead", reply_to: "ctr-5001" }), /Not sent.*as a reply to Mendel/);
  const out = await run("message_contractor", { text: "Approved, go ahead", reply_to: "ctr-5001", confirmed: true });
  assert.match(out, /MCD Builds LLC in the 417 Lakeview Ter job chat as a reply to Mendel/);
  const cm = T.contractor_messages.at(-1).data;
  assert.deepEqual(cm.replyTo, { id: "5001", author: "Mendel", text: "Water heater is leaking — need approval to replace today" });
  assert.equal(cm.taskRefText, "Plumbing");
  assert.equal(cm.jobId, "j1"); assert.equal(cm.side, "team");
  const miss = await run("message_contractor", { property: "417 Lakeview", text: "hello", reply_to: "123", confirmed: true });
  assert.match(miss, /couldn't find message 123 — posted as a normal message/);
  assert.ok(!T.contractor_messages.at(-1).data.replyTo);
});

test("contractor_messages + unread_messages show ids", async () => {
  const cmOut = await run("contractor_messages", { property: "417 Lakeview" });
  assert.match(cmOut, /\[id 5001\] .* Mendel \(contractor\): Water heater/);
  assert.match(cmOut, /↩ \(replying to Mendel: "Water heater/);
  const un = await run("unread_messages", {});
  assert.match(un, /\[id 1003\]/);
  assert.match(un, /\[id ctr-5001\]/);
  assert.match(un, /\[id 4001\]/);
});
