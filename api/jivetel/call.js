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
    // "why" names the person the server matched and what's missing — shows in
    // the call popup so a hidden Jivetel option explains itself in one look.
    return res.status(200).json({ enabled, from: enabled ? ani : "", why: enabled ? "" : `missing ${missing.join(" + ")} for "${person || prof?.name || user.email || "this login"}"` });
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
    if (!r.ok) return res.status(502).json({ error: `Click2Call failed (${r.status})`, detail: text.slice(0, 300) });
    let data = null; try { data = JSON.parse(text); } catch { /* non-JSON OK */ }
    // Jivetel can return HTTP 200 with {result:false, msg:"..."} — surface
    // that as the failure it is instead of a confusing ok:true.
    if (data && data.result === false) return res.status(502).json({ ok: false, error: data.msg || "Click2Call rejected the call.", detail: data });
    return res.status(200).json({ ok: true, ringing: ext, thenDialing: body.Destination, callerId: body.Ani, result: data ?? text.slice(0, 200) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
