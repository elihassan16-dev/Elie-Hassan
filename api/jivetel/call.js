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
import { checkOutreach, firstName as jvFirst } from "../../lib/jivetel.js";
import { createClient } from "@supabase/supabase-js";
import { resolveCallPerson, click2call, callFirst } from "../../lib/jivetelCall.js";

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

const first = callFirst;
const resolvePerson = resolveCallPerson;

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
    // 🔒 Someone else's contact? Block, and the owner just got an approval ask.
    if (!isTest) {
      const gate = await checkOutreach(to, prof?.name || person || "", "call");
      if (!gate.allowed) {
        const cap = jvFirst(gate.owner).replace(/^./, (c) => c.toUpperCase());
        return res.status(403).json({ error: `This is ${cap}'s contact — ${cap} just got an approval request. Once ${cap} approves, you can call them.`, needsApproval: true, owner: cap });
      }
    }
    // In test mode ?ext= tries a different extension@domain without a
    // Vercel round-trip — for pinning down the right domain with support.
    const ext = (isTest && String(req.query.ext || "").trim()) || creds.ext;
    const out = await click2call({ person, creds, ani, to, ext });
    return res.status(out.status).json(out.body);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
