// Preview-harness network layer for the MAIN app — no backend, no Supabase.
// qbAuthFetch answers the app's API routes with safe, realistic canned shapes
// so pages render instead of erroring. Aliased in by vite.appdemo.config.js.
export const attachmentKind = (mime = "") => mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "file";
export const sanitizeName = (n = "file") => n;
export const STREAM_VIDEO_CAP = 200 * 1024 * 1024;
export async function notify() { /* preview */ }
export async function compressImage(file) { return file; }
export async function waitStreamReady() { return true; }
export async function uploadAttachment(file) {
  return { url: URL.createObjectURL(file), name: file.name || "file", mime: file.type || "", kind: attachmentKind(file.type || "") };
}
export async function uploadStreamVideo(file) { return uploadAttachment(file); }

// Demo ShowingTime feed for the On-Market property — shared with appMockData
// so saved lead statuses key to the same showings (key = start-minute + agent).
const shAt = (n, h) => { const x = new Date(); x.setDate(x.getDate() + n); x.setHours(h, 0, 0, 0); return x.toISOString(); };
const HANOVER = "1030 Hanover Blvd, Browns Mills, NJ 08015";
export const DEMO_SHOWINGS = [
  { agent: "Dominique Bell", phone: "(609) 555-0177", broker: "Keller Williams Premier", d: -6, h: 10 },
  { agent: "Marc Rivera", phone: "(732) 555-0164", broker: "RE/MAX Central", d: -4, h: 13 },
  { agent: "Sarah Chen", phone: "(848) 555-0102", broker: "Compass NJ", d: -4, h: 15 },
  { agent: "Dominique Bell", phone: "(609) 555-0177", broker: "Keller Williams Premier", d: -2, h: 11 },
  { agent: "Yosef Adler", phone: "(917) 555-0139", broker: "eXp Realty", d: -1, h: 16 },
  { agent: "Tanya Brooks", phone: "(609) 555-0155", broker: "Century 21 Action", d: 2, h: 14 },
].map((s, i) => ({ uid: `demo-sh-${i}`, start: shAt(s.d, s.h), end: shAt(s.d, s.h + 1), summary: `Showing — ${HANOVER}`, location: HANOVER, status: "CONFIRMED", agent: s.agent, phone: s.phone, broker: s.broker, email: "" }));
export const demoShowingKey = (s) => `${String(s.start).slice(0, 16)}|${s.agent.trim().toLowerCase().replace(/\s+/g, " ")}`;

// Demo call history for the 📞 phone popup — numbers match the showing agents
// and the Papa Pay buyer above so names/roles/properties resolve. Rows carry
// the same shape the webhook writes to sms_messages (kind:"call").
const cAt = (mins) => new Date(Date.now() - mins * 60000).toISOString();
export const DEMO_CALLS = [
  { phone: "(609) 555-0177", dir: "call-in", m: 95, missed: true, ext: "101" },            // Dominique Bell — missed, Elie's line
  { phone: "(609) 555-0123", dir: "call-in", m: 260, missed: true, ext: "102" },           // unknown number — missed, Moshe's line
  { phone: "(908) 555-0142", dir: "call-in", m: 320, talk: 312, ext: "101" },              // Papa Pay (buyer) — answered
  { phone: "(732) 555-0164", dir: "call-out", m: 1500, talk: 233, ext: "101" },            // Marc Rivera — outgoing
  { phone: "(848) 555-0102", dir: "call-in", m: 1560, talk: 141, ext: "103" },             // Sarah Chen — Esti answered
  { phone: "(917) 555-0139", dir: "call-out", m: 1720, talk: 0, ext: "102" },              // Yosef Adler — out, no answer
  { phone: "(609) 555-0155", dir: "call-in", m: 2890, talk: 372, ext: "101" },             // Tanya Brooks — answered
  { phone: "(609) 555-0177", dir: "call-out", m: 3050, talk: 64, ext: "101" },             // Dominique Bell — call back
  { phone: "(732) 555-0198", dir: "call-in", m: 11000, missed: true, ext: "103" },         // unknown — missed on Esti's line (old, off the badge)
].map((c, i) => ({ id: "demo-call-" + i, phone: c.phone, data: { kind: "call", direction: c.dir, at: cAt(c.m), talkSecs: c.talk || 0, missed: !!c.missed, ext: c.ext } }));

// Demo text threads for the Showings → 💬 Messages column. Outgoing rows carry
// prop so smsThreadForProp files each chat under 1030 Hanover; the mock auth
// user's smsRead stamps (mockSupabase) mark everything but Dominique read.
const tAt = (mins) => new Date(Date.now() - mins * 60000).toISOString();
export const DEMO_TEXTS = [
  { phone: "(609) 555-0177", dir: "out", m: 2000, text: "Hi Dominique, thanks for showing 1030 Hanover — any feedback from your buyers?" },
  { phone: "(609) 555-0177", dir: "in", m: 1900, text: "They loved it! Thinking it over this weekend." },
  { phone: "(609) 555-0177", dir: "out", m: 300, text: "Great — happy to hold Sunday afternoon for a second look." },
  { phone: "(609) 555-0177", dir: "in", m: 95, text: "My buyers want to come back Sunday with their parents — does 1pm work?" },
  { phone: "(609) 555-0177", dir: "in", m: 80, text: "Also, is the seller open on price at all?" },
  { phone: "(908) 555-0142", dir: "in", m: 1560, text: "Hi, following up on my offer for 1030 Hanover." },
  { phone: "(908) 555-0142", dir: "out", m: 1500, text: "The seller reviewed your offer — call me when you're free." },
  { phone: "(732) 555-0164", dir: "out", m: 12100, text: "Marc, any word from your clients on 1030 Hanover?" },
  { phone: "(732) 555-0164", dir: "in", m: 12000, text: "Clients liked it, weighing another listing. Will circle back." },
  { phone: "(848) 555-0102", dir: "out", m: 7300, text: "Hi Sarah, any feedback from Monday's showing at 1030 Hanover?" },
  { phone: "(609) 555-0155", dir: "in", m: 14500, text: "Confirming Sunday 2 PM — lockbox code same as last time?" },
].map((t, i) => ({ id: "demo-sms-" + i, phone: t.phone, data: { direction: t.dir, at: tAt(t.m), text: t.text, ...(t.dir === "out" ? { prop: "1030 Hanover Blvd" } : {}) } }));

export async function qbAuthFetch(path) {
  const p = String(path);
  if (p.includes("/api/showings/status")) return { configured: true, feeds: [{ id: 1, label: "ShowingTime" }] };
  if (p.includes("/api/showings/save")) return { ok: true };
  if (p.includes("/api/showings")) return { configured: true, showings: DEMO_SHOWINGS };
  if (p.includes("/api/jivetel/send")) return { connected: true, from: "+17325550100", lines: {} };
  if (p.includes("/api/jivetel/call")) {
    if (p.includes("cap=1")) return { enabled: true, from: "+17325550100", me: "Elie", exts: { elie: "101", moshe: "102", esti: "103" } };
    return { ok: true };
  }
  if (p.includes("/api/team/roster")) return { names: ["Elie Hassan", "Moshe Hamaoui", "Esti Ungar"] };
  if (p.includes("/api/quickbooks/transactions")) {
    const qd = (n) => { const x = new Date(); x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10); };
    return { items: [
      { id: "tx1", date: qd(2), vendor: "Shia Polak Construction", memo: "Wire — draw 3", account: "Construction", type: "Expense", amount: -15000, project: "1030 Hanover Blvd" },
      { id: "tx6", date: qd(4), vendor: "Garden State Lumber", memo: "Wire — lumber package (two jobs)", account: "Materials", type: "Expense", amount: -12000, project: "1030 Hanover Blvd" },
      { id: "tx6", date: qd(4), vendor: "Garden State Lumber", memo: "Wire — lumber package (two jobs)", account: "Materials", type: "Expense", amount: -8000, project: "417 Lakeview Ter" },
      { id: "tx2", date: qd(6), vendor: "", memo: "A/C: SHIA POLAK CONST — wire out", account: "Construction", type: "Transfer", amount: -8000, project: "1030 Hanover Blvd" },
      { id: "tx3", date: qd(9), vendor: "Home Depot", memo: "Materials", account: "Materials", type: "Expense", amount: -1240, project: "417 Lakeview Ter" },
      { id: "tx4", date: qd(14), vendor: "Shia Polak Construction", memo: "Check #1188 — draw 2", account: "Construction", type: "Check", amount: -17500, project: "1030 Hanover Blvd" },
      { id: "tx5", date: qd(20), vendor: "PSE&G", memo: "Utilities", account: "Utilities", type: "Expense", amount: -212, project: "" },
    ] };
  }
  if (p.includes("/api/quickbooks")) return { connected: false, rows: [], income: 0, cogs: 0, expenses: 0, netIncome: 0 };
  if (p.includes("/api/boldtrail")) return { leads: [] };
  if (p.includes("/api/rentcast/value")) {
    const d = (n) => { const x = new Date(); x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10); };
    return {
      at: new Date().toISOString(), filters: { radius: 1, months: 12 },
      value: { price: 426000, low: 400000, high: 452000 },
      subject: { sqft: 2056, beds: 4, baths: 2, yearBuilt: 1972, lotSize: 10890, type: "Single Family", pool: false, garage: true, garageSpaces: 2, county: "Burlington", zoning: "R-2", apn: "05076-103-0500", heating: "Forced Air", cooling: "Central", architecture: "Colonial", owner: "Goldstone Properties LLC" },
      comps: [
        { address: "323 Dermody St", full: "323 Dermody St, Pemberton, NJ 08068", price: 495000, priceSrc: "sold", sqft: 1980, beds: 4, baths: 2, distance: 0.15, daysOld: 22, date: d(22) },
        { address: "248 W 3rd Ave", full: "248 W 3rd Ave, Pemberton, NJ 08068", price: 450000, priceSrc: "sold", sqft: 1890, beds: 3, baths: 2, distance: 0.32, daysOld: 95, date: d(95) },
        { address: "207 Clover St", full: "207 Clover St, Pemberton, NJ 08068", price: 275000, priceSrc: "sold", sqft: 1510, beds: 3, baths: 1, distance: 0.02, daysOld: 60, date: d(60) },
        { address: "88 Maple Ave", full: "88 Maple Ave, Pemberton, NJ 08068", price: 610000, priceSrc: "sold", sqft: 3120, beds: 5, baths: 3, distance: 0.6, daysOld: 130, date: d(130) },
        { address: "399 Division St", full: "399 Division St, Pemberton, NJ 08068", price: 474999, priceSrc: "list", sqft: 2120, beds: 4, baths: 2, distance: 0.19, daysOld: 12, date: d(12), dom: 34, recNote: "off-market:" + d(12) + "·34dom" },
        { address: "61 Juliustown Rd", full: "61 Juliustown Rd, Pemberton, NJ 08068", price: 439000, priceSrc: "sold", sqft: 2010, beds: 4, baths: 2, distance: 0.44, daysOld: 210, date: d(210) },
      ],
    };
  }
  if (p.includes("/api/ai/arv")) {
    return { arv: 476000, low: 458000, high: 494000, psf: 232, reasoning: "Preview-mode sample underwrite built from your checked comps — the live site runs the real AI.", used: [{ i: 0, why: "renovated, near-identical size" }, { i: 1, why: "updated, $238/sf" }], skipped: [{ i: 2, why: "as-is estate sale" }] };
  }
  if (p.includes("/api/rentcast")) throw new Error("Preview mode — RentCast runs on the live site.");
  if (p.includes("/api/ai/")) throw new Error("Preview mode — AI runs on the live site.");
  return { ok: true };
}

// Route Planner preview: deterministic fake coordinates around Burlington
// County so routes render offline — same address always lands the same spot.
export async function geocodeAddress(q) {
  let h = 0;
  for (const ch of String(q)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { lat: 39.85 + ((h % 1000) / 1000) * 0.45, lng: -75.05 + (((h >> 10) % 1000) / 1000) * 0.55 };
}
