// Jivetel Click2Call — shared by api/jivetel/call.js (the app's 📞 button) and
// the Claude connector's place_call: rings the caller's OWN Jivetel phone
// first (desk phone / Jivetel app — RingAll), then dials the destination and
// bridges. Portal credentials are per person:
//   JIVETEL_CALL_HOST                    e.g. "https://online.jivetel.com"
//   JIVETEL_CALL_USER_ELIE / _PASS_ELIE / _EXT_ELIE   (and _MOSHE, _ESTI …)
//   JIVETEL_CALL_USER / _PASS / _EXT     un-suffixed = Elie's (legacy names)
// Extension format is "{extension}@{domain}", e.g. "101@GOLDSTONEPROPE".
// The caller ID (Ani) comes from the person's own line in JIVETEL_NUMBERS.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co";

export const callHost = () => String(process.env.JIVETEL_CALL_HOST || "").replace(/\/+$/, "");
const first = (s) => String(s || "").trim().toLowerCase().split(/[\s@]+/)[0];
// Tolerant first-name match ("Esti" vs "Estie"): equal, or one is the
// other's prefix at 3+ letters.
const sameFirst = (a, b) => { a = first(a); b = first(b); if (!a || !b) return false; if (a === b) return true; return a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a)); };
export const callFirst = first;

// Who is calling, their portal creds, and the caller ID to show.
export function resolveCallPerson(user, fromName, profileName) {
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

// Last desk-call attempts (admin-readable via GET /api/jivetel/call?log=1):
// enough to see WHY a click-to-call failed. Best-effort, never blocks a call.
export async function logCallAttempt(entry) {
  try {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) return;
    const db = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
    const row = (await db.from("app_settings").select("data").eq("id", "jivetel_call_log").maybeSingle()).data;
    const list = ((row && row.data && row.data.attempts) || []).slice(-24);
    list.push({ at: new Date().toISOString(), ...entry });
    await db.from("app_settings").upsert({ id: "jivetel_call_log", data: { attempts: list }, updated_at: new Date().toISOString() });
  } catch { /* diagnostics only */ }
}

const digits = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.length === 11 && d.startsWith("1") ? d.slice(1) : d; };

// Place the call. Returns {status, body} shaped like the API's answers.
export async function click2call({ person, creds, ani, to, ext: extOverride }) {
  const host = callHost();
  const ext = extOverride || creds.ext;
  if (!host || !creds.username || !creds.password || !ext) {
    await logCallAttempt({ person, ext: String(ext || ""), to: String(to), ok: false, msg: "not configured (missing " + [!host && "host", !creds.username && "username", !creds.password && "password", !ext && "extension"].filter(Boolean).join(", ") + ")" });
    return { status: 503, body: { error: `Calling isn't set up for ${person || "you"} yet.` } };
  }
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
    await logCallAttempt({ person, ext, to: body.Destination, ok: false, msg: `HTTP ${r.status}: ${text.slice(0, 200)}` });
    return { status: 502, body: { error: `Click2Call failed (${r.status})`, detail: text.slice(0, 300) } };
  }
  let data = null; try { data = JSON.parse(text); } catch { /* non-JSON OK */ }
  // Jivetel can return HTTP 200 with {result:false, msg:"..."} — surface
  // that as the failure it is instead of a confusing ok:true. Its generic
  // "Failed to place call" is almost always the extension/desk-phone side,
  // so flag the one misconfiguration we can spot from here outright.
  if (data && data.result === false) {
    const hint = String(ext).includes("@") ? "" : " — the extension is configured without its @domain (Jivetel needs extension@domain)";
    await logCallAttempt({ person, ext, to: body.Destination, ok: false, msg: String(data.msg || "rejected") });
    return { status: 502, body: { ok: false, error: `Jivetel said: ${data.msg || "call rejected"}${hint}`, detail: data } };
  }
  await logCallAttempt({ person, ext, to: body.Destination, ok: true, msg: "" });
  return { status: 200, body: { ok: true, ringing: ext, thenDialing: body.Destination, callerId: body.Ani, result: data ?? text.slice(0, 200) } };
}
