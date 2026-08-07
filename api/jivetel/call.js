// Place a call through Jivetel's Click2Call: rings the caller's own Jivetel
// phone first, then dials the destination and bridges. Portal credentials are
// per person (each person's calls ring THEIR extension):
//   JIVETEL_CALL_HOST                    e.g. "https://online.jivetel.com"
//   JIVETEL_CALL_USER_ELIE / _PASS_ELIE / _EXT_ELIE   (and _MOSHE, _ESTI …)
//   JIVETEL_CALL_USER / _PASS / _EXT     un-suffixed = Elie's (legacy names)
// Extension format is "{extension}@{domain}", e.g. "101@GOLDSTONEPROPE".
// The caller ID (Ani) comes from the person's own line in JIVETEL_NUMBERS.
// GET ?cap=1 (signed-in) answers "is calling set up for me?" for the UI.
import { requireAppUser } from "../../lib/showings.js";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

// The auth login often has no display name stored — the app's own users
// table always does. Also tells us the role, so contractors never get
// calling no matter what their name matches.
async function profileOf(userId) {
  try {
    if (!SERVICE || !userId) return null;
    const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
    const { data } = await db.from("users").select("name,role").eq("id", userId).maybeSingle();
    return data || null;
  } catch { return null; }
}

const first = (s) => String(s || "").trim().toLowerCase().split(/[\s@]+/)[0];

// Last desk-call attempts (admin-readable via GET ?log=1): enough to see WHY
// a click-to-call failed — extension typo, bad creds, Jivetel rejection —
// without hunting through Vercel logs. Best-effort, never blocks a call.
async function logAttempt(entry) {
  try {
    if (!SERVICE) return;
    const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
    const row = (await db.from("app_settings").select("data").eq("id", "jivetel_call_log").maybeSingle()).data;
    const list = ((row && row.data && row.data.attempts) || []).slice(-24);
    list.push({ at: new Date().toISOString(), ...entry });
    await db.from("app_settings").upsert({ id: "jivetel_call_log", data: { attempts: list }, updated_at: new Date().toISOString() });
  } catch { /* diagnostics only */ }
}

// Tolerant first-name match ("Esti" vs "Estie"): equal, or one is the
// other's prefix at 3+ letters.
const sameFirst = (a, b) => { a = first(a); b = first(b); if (!a || !b) return false; if (a === b) return true; return a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a)); };

// Who is calling, their portal creds, and the caller ID to show.
function resolvePerson(user, fromName, profileName) {
  let numbers = {};
  try { numbers = JSON.parse(process.env.JIVETEL_NUMBERS || "{}"); } catch { /* default only */ }
  const cands = [fromName, user?.user_metadata?.name, profileName, user?.email].filter(Boolean);
  let person = null;
  for (const c of cands) {
    const k = numbers[c] != null ? c : Object.keys(numbers).find((x) => sameFirst(x, c));
    if (k) { person = k; break; }
  }
  if (!person && cands.length) person = cands.find((c) => !String(c).includes("@")) || cands[0];
  const sfx = first(person || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const legacy = sfx === "ELIE"; // Elie's creds may live in the un-suffixed vars
  const creds = {
    username: process.env["JIVETEL_CALL_USER_" + sfx] || (legacy ? process.env.JIVETEL_CALL_USER : null),
    password: process.env["JIVETEL_CALL_PASS_" + sfx] || (legacy ? process.env.JIVETEL_CALL_PASS : null),
    ext: process.env["JIVETEL_CALL_EXT_" + sfx] || (legacy ? process.env.JIVETEL_CALL_EXT : null),
  };
  const ani = (person && numbers[person]) || process.env.JIVETEL_FROM_DEFAULT || "";
  return { person, creds, ani };
}

export default async function handler(req, res) {
  const host = String(process.env.JIVETEL_CALL_HOST || "").replace(/\/+$/, "");
  // Signed-in capability check for the app UI — no key needed, tells the
  // caller whether THEIR line is wired up (drives showing/hiding the option).
  if (req.method === "GET" && req.query.cap) {
    const user = await requireAppUser(req);
    if (!user) return res.status(401).json({ error: "Sign in first." });
    const prof = await profileOf(user.id);
    if (prof?.role === "contractor") return res.status(200).json({ enabled: false, from: "", why: "contractor account" });
    const { person, creds, ani } = resolvePerson(user, null, prof?.name);
    const missing = [!host && "server address", !creds.username && "username", !creds.password && "password", !creds.ext && "extension"].filter(Boolean);
    const enabled = !missing.length;
    // Which extension is whose (owner → ext digits, from JIVETEL_CALL_EXT_*):
    // the phone popup's All/Mine/Moshe/Esti history tabs come from this map.
    const exts = {};
    for (const [k, v] of Object.entries(process.env)) {
      const m = /^JIVETEL_CALL_EXT_([A-Z0-9]+)$/.exec(k);
      if (m && String(v || "").split("@")[0]) exts[m[1].toLowerCase()] = String(v).split("@")[0];
    }
    if (!exts.elie && process.env.JIVETEL_CALL_EXT) exts.elie = String(process.env.JIVETEL_CALL_EXT).split("@")[0];
    // "why" names the person the server matched and what's missing — shows in
    // the call popup so a hidden Jivetel option explains itself in one look.
    return res.status(200).json({ enabled, from: enabled ? ani : "", me: first(person || prof?.name || ""), exts, why: enabled ? "" : `missing ${missing.join(" + ")} for "${person || prof?.name || user.email || "this login"}"` });
  }
  // Signed-in admin peek at the recent desk-call attempts and how Jivetel
  // answered each one — GET /api/jivetel/call?log=1 while signed in.
  if (req.method === "GET" && req.query.log) {
    const user = await requireAppUser(req);
    if (!user) return res.status(401).json({ error: "Sign in first." });
    const prof = await profileOf(user.id);
    if (prof?.role !== "admin") return res.status(403).json({ error: "Admins only." });
    if (!SERVICE) return res.status(200).json({ attempts: [] });
    const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
    const { data } = await db.from("app_settings").select("data").eq("id", "jivetel_call_log").maybeSingle();
    return res.status(200).json({ attempts: (((data || {}).data || {}).attempts || []).slice().reverse() });
  }
  // Browser test door, gated like the webhook:
  // GET /api/jivetel/call?key=SECRET&to=7325551234[&ext=101@DOMAIN]
  const isTest = req.method === "GET";
  if (isTest) {
    const secret = process.env.JIVETEL_WEBHOOK_SECRET;
    if (!secret || String(req.query.key || "") !== secret) return res.status(401).json({ error: "bad key" });
  } else if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }
  const user = isTest ? { user_metadata: { name: String(req.query.fromName || "Elie") } } : await requireAppUser(req);
  if (!user) return res.status(401).json({ error: "Sign in first." });
  try {
    const { to, fromName } = isTest ? { to: req.query.to, fromName: req.query.fromName } : req.body || {};
    if (!to) return res.status(400).json({ error: "to is required." });
    const prof = isTest ? null : await profileOf(user.id);
    if (prof?.role === "contractor") return res.status(403).json({ error: "Calling isn't available on contractor accounts." });
    const { person, creds, ani } = resolvePerson(user, fromName, prof?.name);
    // In test mode ?ext= tries a different extension@domain without a
    // Vercel round-trip — for pinning down the right domain with support.
    const ext = (isTest && String(req.query.ext || "").trim()) || creds.ext;
    if (!host || !creds.username || !creds.password || !ext) {
      await logAttempt({ person, ext: String(ext || ""), to: String(to), ok: false, msg: "not configured (missing " + [!host && "host", !creds.username && "username", !creds.password && "password", !ext && "extension"].filter(Boolean).join(" + ") + ")" });
      return res.status(503).json({ error: `Calling isn't set up for ${person || "you"} yet.` });
    }
    const digits = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.length === 11 && d.startsWith("1") ? d.slice(1) : d; };
    const body = {
      Username: creds.username,
      Password: creds.password,
      Extension: ext,
      Destination: digits(to),
      Ani: digits(ani),
      AutoAnswer: false,
      RingAll: true,
      PlaceInQueue: false,
    };
    const r = await fetch(host + "/api/QYLJTLuf3HjzEr2/Click2Call.aspx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) {
      await logAttempt({ person, ext, to: body.Destination, ok: false, msg: `HTTP ${r.status}: ${text.slice(0, 200)}` });
      return res.status(502).json({ error: `Click2Call failed (${r.status})`, detail: text.slice(0, 300) });
    }
    let data = null; try { data = JSON.parse(text); } catch { /* non-JSON OK */ }
    // Jivetel can return HTTP 200 with {result:false, msg:"..."} — surface
    // that as the failure it is instead of a confusing ok:true. Its generic
    // "Failed to place call" is almost always the extension/desk-phone side,
    // so flag the one misconfiguration we can spot from here outright.
    if (data && data.result === false) {
      const hint = String(ext).includes("@") ? "" : " — the extension is configured without its @domain (Jivetel needs extension@domain)";
      await logAttempt({ person, ext, to: body.Destination, ok: false, msg: String(data.msg || "rejected") });
      return res.status(502).json({ ok: false, error: `Jivetel said: ${data.msg || "call rejected"}${hint}`, detail: data });
    }
    await logAttempt({ person, ext, to: body.Destination, ok: true, msg: "" });
    return res.status(200).json({ ok: true, ringing: ext, thenDialing: body.Destination, callerId: body.Ani, result: data ?? text.slice(0, 200) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
