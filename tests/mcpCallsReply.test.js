// node --test tests/ — the connector's recent_calls and reply_email-with-
// attachments tools (lib/mcpTools.js), end to end against a FAKE Supabase +
// Microsoft Graph (global fetch is stubbed; nothing leaves the machine).
import { test, before } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.AZURE_CLIENT_SECRET = "test-secret";
process.env.JIVETEL_CALL_EXT_ELIE = "101@GOLDSTONEPROPE";
process.env.JIVETEL_CALL_EXT_MOSHE = "102@GOLDSTONEPROPE";
delete process.env.JIVETEL_CALL_EXT;
delete process.env.JIVETEL_NUMBERS;

const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const CALLS = [
  { id: "c1", dir: "in", phone: "7325550101", name: "WIRELESS CALLER", ext: "101", at: ago(2), talk: 125, answered: true },
  { id: "c2", dir: "in", phone: "7325550102", name: "", ext: "101", at: ago(5), talk: 0, answered: false },
  { id: "c3", dir: "in", phone: "7325550103", name: "", ext: "101", at: ago(6), talk: 31, answered: true, vm: true },
  { id: "c4", dir: "out", phone: "7325550101", name: "", ext: "101", at: ago(8), talk: 0, answered: false },
  { id: "c5", dir: "in", phone: "7325550104", name: "", ext: "102", at: ago(3), talk: 60, answered: true },   // Moshe's line — not mine
  { id: "c6", dir: "in", phone: "7325550105", name: "", ext: "9100", at: ago(4), talk: 0, answered: false },  // master line — shared
  { id: "c7", dir: "in", phone: "7325550101", name: "", ext: "101", at: ago(24 * 10), talk: 10, answered: true }, // too old for 7 days
];
const CONTACTS = [{ data: { name: "Tsivia Cynamon", phones: [{ number: "(732) 555-0101", label: "Mobile" }] } }];

const graphLog = [];
let uploadChunks = [];
const BIG = 4 * 1024 * 1024 + 123; // > 3 MB → upload session

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
before(() => {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url), method = (opts.method || "GET").toUpperCase();
    if (u.includes("login.microsoftonline.com")) return json({ access_token: "tok", expires_in: 3600 });
    if (u.includes("/rest/v1/app_settings")) return json(u.includes("jivetel_calls") ? [{ data: { calls: CALLS } }] : []);
    if (u.includes("/rest/v1/contacts")) return json(CONTACTS);
    if (u.includes("/rest/v1/")) return json([]);
    if (u.startsWith("https://upload.example/")) {
      uploadChunks.push({ range: opts.headers["Content-Range"], len: Number(opts.headers["Content-Length"]) });
      return json({}, 200);
    }
    if (u.includes("graph.microsoft.com")) {
      const path = u.replace("https://graph.microsoft.com/v1.0", "");
      graphLog.push(`${method} ${path.split("?")[0]}`);
      if (method === "GET" && /\/messages\/SRC\/attachments$/.test(path.split("?")[0]))
        return json({ value: [{ id: "A1", name: "Contract.pdf", contentType: "application/pdf", size: 2048, isInline: false }, { id: "A2", name: "Plans.pdf", contentType: "application/pdf", size: BIG, isInline: false }] });
      if (method === "GET" && /\/attachments\/A1\/\$value$/.test(path)) return new Response(new Uint8Array(2048), { status: 200 });
      if (method === "GET" && /\/attachments\/A2\/\$value$/.test(path)) return new Response(new Uint8Array(BIG), { status: 200 });
      if (method === "POST" && /\/createReply(All)?$/.test(path)) return json({ id: "DRAFT", body: { content: "<p>original</p>" }, ccRecipients: [] }, 201);
      if (method === "POST" && /\/attachments\/createUploadSession$/.test(path)) return json({ uploadUrl: "https://upload.example/s1" }, 201);
      if (method === "POST" && /\/attachments$/.test(path)) return json({ id: "att" }, 201);
      if (method === "POST" && /\/send$/.test(path)) return new Response(null, { status: 202 });
      if (method === "PATCH") return json({ id: "DRAFT" });
      if (method === "DELETE") return new Response(null, { status: 204 });
      return json({ error: { message: "unexpected " + method + " " + path } }, 404);
    }
    throw new Error("unexpected fetch " + u);
  };
});

const me = { id: "u1", email: "elie@example.com", name: "Elie Hassan", role: "admin" };
const load = async () => (await import("../lib/mcpTools.js")).runTool;

test("recent_calls: own extension + shared lines, contact names, statuses", async () => {
  const run = await load();
  const out = await run("recent_calls", {}, me);
  assert.match(out, /^5 calls in the last 7 days \(ext 101 \+ shared lines\)/);
  assert.ok(!out.includes("555-0104") && !out.includes("+17325550104"), "Moshe's ext 102 call is not mine");
  assert.ok(!out.includes("10m 10s"));
  assert.match(out, /inbound · Tsivia Cynamon \+17325550101 · ✅ answered · 2m 5s · ext 101/);
  assert.match(out, /\+17325550102 · ❌ missed/);
  assert.match(out, /\+17325550103 · 📼 voicemail · 31s/);
  assert.match(out, /outbound · Tsivia Cynamon \+17325550101 · ⚪ no answer/);
  assert.match(out, /\+17325550105 · ❌ missed · ext 9100/); // master line
  assert.match(out, /America|AM|PM/);
});

test("recent_calls: filters (direction, contact, number, limit, days)", async () => {
  const run = await load();
  const missed = await run("recent_calls", { direction: "missed" }, me);
  assert.match(missed, /^3 calls/); // missed + voicemail + master-line missed
  const out = await run("recent_calls", { direction: "outbound" }, me);
  assert.match(out, /^1 call /);
  const byName = await run("recent_calls", { number_or_contact: "tsivia" }, me);
  assert.match(byName, /^2 calls/);
  const byNum = await run("recent_calls", { number_or_contact: "(732) 555-0103" }, me);
  assert.match(byNum, /^1 call .*voicemail/s);
  const lim = await run("recent_calls", { limit: 2 }, me);
  assert.match(lim, /newest 2 shown/);
  const all = await run("recent_calls", { days: 30, number_or_contact: "7325550101" }, me);
  assert.match(all, /^3 calls in the last 30 days/);
  const none = await run("recent_calls", { number_or_contact: "Nobody Here" }, me);
  assert.match(none, /No contact named/);
});

test("reply_email: needs confirmed=true", async () => {
  const run = await load();
  await assert.rejects(() => run("reply_email", { id: "MSG", body: "hi" }, me), /Not sent/);
});

test("reply_email: threaded reply with a small + a >3 MB attachment (upload session)", async () => {
  const run = await load();
  graphLog.length = 0; uploadChunks = [];
  const out = await run("reply_email", { id: "MSG", body: "See attached", reply_all: true, attachments: [{ email_id: "SRC" }], confirmed: true }, me);
  assert.equal(out, "Reply (all) sent from elie@example.com — attached Contract.pdf, Plans.pdf.");
  const steps = graphLog.filter((x) => !x.startsWith("GET"));
  assert.deepEqual(steps, [
    "POST /users/elie%40example.com/messages/MSG/createReplyAll",
    "PATCH /users/elie%40example.com/messages/DRAFT",
    "POST /users/elie%40example.com/messages/DRAFT/attachments",
    "POST /users/elie%40example.com/messages/DRAFT/attachments/createUploadSession",
    "POST /users/elie%40example.com/messages/DRAFT/send",
  ]);
  // Every chunk but the last is a multiple of 320 KiB, and together they cover the file.
  assert.ok(uploadChunks.length >= 2);
  uploadChunks.slice(0, -1).forEach((c) => assert.equal(c.len % (320 * 1024), 0));
  assert.equal(uploadChunks.reduce((t, c) => t + c.len, 0), BIG);
  assert.match(uploadChunks.at(-1).range, new RegExp(`/${BIG}$`));
});

test("reply_email: no attachments still works (createReply, no extra steps)", async () => {
  const run = await load();
  graphLog.length = 0;
  const out = await run("reply_email", { id: "MSG", body: "Thanks!", confirmed: true }, me);
  assert.equal(out, "Reply sent from elie@example.com.");
  assert.deepEqual(graphLog, [
    "POST /users/elie%40example.com/messages/MSG/createReply",
    "PATCH /users/elie%40example.com/messages/DRAFT",
    "POST /users/elie%40example.com/messages/DRAFT/send",
  ]);
});

test("reply_email: a missing attachment fails before any draft is made", async () => {
  const run = await load();
  graphLog.length = 0;
  await assert.rejects(() => run("reply_email", { id: "MSG", body: "x", attachments: [{ email_id: "SRC", attachment: "Nope.docx" }], confirmed: true }, me), /no attachment like/);
  assert.ok(!graphLog.some((x) => /createReply/.test(x)));
  await assert.rejects(() => run("reply_email", { id: "MSG", body: "x", attachments: [{ url: "https://evil.example/x.pdf" }], confirmed: true }, me), /Only links to Goldstone/);
});

test("reply_email: if sending fails, the half-built draft is deleted", async () => {
  const run = await load();
  graphLog.length = 0;
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => (/\/DRAFT\/send$/.test(String(url)) ? json({ error: { message: "Mailbox busy" } }, 500) : real(url, opts));
  try {
    await assert.rejects(() => run("reply_email", { id: "MSG", body: "x", confirmed: true }, me), /Mailbox busy/);
    assert.ok(graphLog.includes("DELETE /users/elie%40example.com/messages/DRAFT"));
  } finally { globalThis.fetch = real; }
});

test("recent_calls output (printed for review)", async () => {
  const run = await load();
  console.log(await run("recent_calls", {}, me));
});
