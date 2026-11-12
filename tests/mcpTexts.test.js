// node --test tests/ — the connector's recent_texts + the forgiving get_texts
// "with" (partial number, area code + time, close matches), end to end against
// an in-memory FAKE Supabase (global fetch is stubbed; nothing leaves the machine).
import { test, before } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.JIVETEL_NUMBERS = JSON.stringify({ "Elie Hassan": "+16095550100", "Moshe Groner": "+16095550200", "Estie Ungar": "+16095550300" });
delete process.env.JIVETEL_FROM_DEFAULT;
const ELIE = "+16095550100", MOSHE = "+16095550200", OFFICE = "+17325559999";

const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const sms = (id, phone, direction, text, h, from, extra = {}) => ({ id, phone, data: { id, phone, direction, text, at: ago(h), from, ...extra } });
const T = {
  sms_messages: [
    sms("m1", "+16095551234", "in", "Is the house on Elm still available?", 1, ELIE),            // unsaved 609, unread
    sms("m2", "+16095551234", "out", "Yes! Want to see it?", 0.5, ELIE, { by: "Elie Hassan" }),
    sms("m3", "+17325550142", "in", "Thanks, got the keys", 3, ELIE),                             // saved, read
    sms("m4", "+19085550777", "in", "Call me about 12 Oak", 5, OFFICE),                          // shared office line
    sms("m5", "+16095558888", "in", "Moshe's buyer here", 2, MOSHE),                             // Moshe's line — not Elie's
    sms("m6", "+16095552222", "in", "old one", 30, ELIE),                                        // outside 24h
    sms("m7", "+12015550001", "in", "", 4, ELIE, { media: ["https://x/p.jpg"] }),                // picture only
    sms("m8", "+16095553333", "out", "Following up on the showing", 6, "", { by: "Elie Hassan" }), // no line recorded, texted by me
    sms("m9", "+16095554444", "in", "no line, not mine", 6, ""),                                  // no line, never texted by me
    sms("c1", "+16095551234", "in", "", 1, ELIE, { kind: "call" }),                              // a call — never listed
  ],
  contacts: [{ id: "k1", data: { name: "Tsivia Cynamon", phones: [{ number: "(732) 555-0142", label: "Mobile" }] } },
    { id: "k2", data: { name: "Tsivia Klein", phones: [{ number: "(201) 555-0001", label: "Mobile" }] } }],
  app_settings: [{ id: "uprefs_u1", data: { smsRead: { "+17325550142": ago(2), "+16095551234": ago(2) } } }],
};
const parse = (u) => {
  const url = new URL(u); const table = url.pathname.split("/").pop();
  return { table, filters: [...url.searchParams.entries()].filter(([k]) => !["select", "limit", "order"].includes(k)) };
};
const get = (row, k) => (k === "data->>at" ? row.data && row.data.at : row[k] ?? (row.data && row.data[k]));
const match = (row, filters) => filters.every(([k, v]) => {
  const val = String(get(row, k) ?? "");
  if (v.startsWith("eq.")) return val === v.slice(3);
  if (v.startsWith("in.")) return v.slice(4, -1).split(",").map((x) => x.replace(/^"|"$/g, "")).includes(val);
  if (v.startsWith("gte.")) return val >= v.slice(4);
  if (v.startsWith("lte.")) return val <= v.slice(4);
  return true;
});
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
before(() => {
  globalThis.fetch = async (url) => {
    const { table, filters } = parse(String(url));
    return json((T[table] || []).filter((r) => match(r, filters)));
  };
});
const elie = { id: "u1", name: "Elie Hassan", email: "elie@x.com", role: "admin" };
const run = async (name, args, me = elie) => (await import("../lib/mcpTools.js")).runTool(name, args, me);

test("recent_texts: own line + shared line, unsaved numbers, read/unread, newest first", async () => {
  const out = await run("recent_texts", {});
  assert.match(out, /^6 texts .* on your line \(609\) 555-0100 \+ shared lines — 3 unread incoming, newest first:/);
  const lines = out.split("\n").slice(1);
  assert.match(lines[0], /➡ out · \(609\) 555-1234 · unsaved · sent by Elie: "Yes! Want to see it\?"/);
  assert.match(lines[1], /⬅ in · \(609\) 555-1234 · unsaved · UNREAD: "Is the house on Elm/);
  assert.match(out, /⬅ in · \(732\) 555-0142 · Tsivia Cynamon · read: "Thanks, got the keys"/);
  assert.match(out, /\(908\) 555-0777 · unsaved · UNREAD|\(908\) 555-0777 · unsaved · UNREAD/);
  assert.match(out, /\(201\) 555-0001 · Tsivia Klein · UNREAD: \[1 picture\]/);
  assert.match(out, /\(609\) 555-3333 · unsaved · sent by Elie/); // no line recorded, but I texted it
  assert.ok(!out.includes("555-8888"), "Moshe's own line is not Elie's");
  assert.ok(!out.includes("555-4444"), "no-line row nobody on my side texted");
  assert.ok(!out.includes("old one"), "outside the last 24 hours");
  assert.equal(lines.length, 6);
});

test("recent_texts: filters", async () => {
  assert.match(await run("recent_texts", { direction: "outgoing" }), /^2 texts/);
  assert.match(await run("recent_texts", { direction: "incoming" }), /^4 texts/);
  const area = await run("recent_texts", { area_code: "609" });
  assert.match(area, /^3 texts .*area code 609/);
  assert.match(await run("recent_texts", { number_contains: "0142" }), /^1 text .*Tsivia Cynamon/s);
  assert.match(await run("recent_texts", { text_contains: "ELM" }), /^1 text .*Is the house on Elm/s);
  assert.match(await run("recent_texts", { limit: 2 }), /newest 2 shown/);
  assert.match(await run("recent_texts", { since: "48 hours" }), /^7 texts/);
  assert.match(await run("recent_texts", { area_code: "212" }), /^No texts/);
  await assert.rejects(() => run("recent_texts", { since: "the other week-ish" }), /couldn't read/);
});

test("recent_texts: Moshe sees his own line, not Elie's", async () => {
  const out = await run("recent_texts", {}, { id: "u3", name: "Moshe Groner", email: "m@x.com", role: "member" });
  assert.match(out, /555-8888/);
  assert.match(out, /555-0777/); // office line is shared
  assert.ok(!out.includes("555-1234"));
});

test("get_texts: full number + name still work", async () => {
  assert.match(await run("get_texts", { with: "(732) 555-0142" }), /Texts with Tsivia Cynamon .*Thanks, got the keys/s);
  assert.match(await run("get_texts", { with: "Tsivia Cynamon" }), /Texts with Tsivia Cynamon/);
});

test("get_texts: partial number, area code + time, close matches", async () => {
  assert.match(await run("get_texts", { with: "1234" }), /Texts with \(609\) 555-1234 \(unsaved\) — the only number with "1234".*Is the house on Elm.*Want to see it/s);
  assert.match(await run("get_texts", { with: "908 today" }), /Texts with \(908\) 555-0777 .*Call me about 12 Oak/s);
  const many = await run("get_texts", { with: "609" }).catch((e) => e.message);
  assert.match(many, /conversations match area code 609/);
  assert.match(many, /\(609\) 555-1234 \(unsaved\) — 2 texts, last .*→ "Yes! Want to see it\?"/);
  const none = await run("get_texts", { with: "312 yesterday 3pm" }).catch((e) => e.message);
  assert.match(none, /No texts with a number in area code 312 around/);
  const near = await run("get_texts", { with: "609-555-1239" }).catch((e) => e.message);
  assert.match(near, /No texts with \(609\) 555-1239\.\nClose numbers.*555-1234/s);
  const amb = await run("get_texts", { with: "Tsivia" }).catch((e) => e.message);
  assert.match(amb, /matches 2 contacts:\n• Tsivia Cynamon — \(732\) 555-0142\n• Tsivia Klein/);
  const typo = await run("get_texts", { with: "Tsivya Cynamon" }).catch((e) => e.message);
  assert.match(typo, /No contact named "Tsivya Cynamon"\.\nSimilar names in Contacts:\n• Tsivia Cynamon/);
});

test("parseWhen", async () => {
  const { parseWhen } = await import("../lib/textsQuery.js");
  const now = Date.parse("2026-11-12T17:00:00Z"); // Thu Nov 12, noon NY
  assert.equal(parseWhen("2026-11-10", { now }).ms, Date.parse("2026-11-10T05:00:00Z"));
  assert.equal(parseWhen("2026-11-10", { end: true, now }).ms, Date.parse("2026-11-11T04:59:59.999Z"));
  assert.equal(parseWhen("yesterday 3pm", { now }).ms, Date.parse("2026-11-11T20:00:00Z"));
  assert.equal(parseWhen("Nov 10 9:30am", { now }).ms, Date.parse("2026-11-10T14:30:00Z"));
  assert.equal(parseWhen("11/10", { now }).ms, Date.parse("2026-11-10T05:00:00Z"));
  assert.equal(parseWhen("48 hours", { now }).ms, now - 48 * 3600000);
  assert.equal(parseWhen("mon", { now }).ms, Date.parse("2026-11-09T05:00:00Z"));
  assert.equal(parseWhen("2026-07-04 08:00", { now }).ms, Date.parse("2026-07-04T12:00:00Z")); // EDT
  assert.equal(parseWhen("gibberish", { now }), null);
});

test("recent_texts output (printed for review)", async () => {
  console.log(await run("recent_texts", {}));
  console.log(await run("get_texts", { with: "609" }).catch((e) => e.message));
});
