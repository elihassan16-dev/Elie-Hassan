// Server-side ShowingTime (iCalendar feed) helpers — run only in Vercel functions.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0bXN1a2pudXFzcHJ0dmZ5dGluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4NTE4OTUsImV4cCI6MjA5ODQyNzg5NX0.Ul2Vly-p_KzMuiNCkRIhyv0JYP8vLPTtPKp3mXAEjOk";

function admin() {
  if (!SERVICE_ROLE) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY env var.");
  return createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
}

export async function requireAppUser(req) {
  const authz = req.headers.authorization || "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7) : null;
  if (!token) return null;
  const client = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const { data } = await client.auth.getUser(token);
  return data?.user || null;
}

export async function isAdminUser(userId) {
  const { data } = await admin().from("users").select("role").eq("id", userId).maybeSingle();
  return data?.role === "admin";
}

export async function getIcsUrl() {
  const { data } = await admin().from("app_settings").select("data").eq("id", "showingtime").maybeSingle();
  return data?.data?.icsUrl || null;
}
export async function setIcsUrl(url) {
  await admin().from("app_settings").upsert({ id: "showingtime", data: { icsUrl: url }, updated_at: new Date().toISOString() });
}

// ── Minimal iCalendar (.ics) parsing ─────────────────────────────────────────
function unescapeText(v) {
  return (v || "").replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}
function parseIcsDate(val) {
  const m = String(val).match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  const [, Y, Mo, D, h, mi, s, z] = m;
  if (h === undefined) return `${Y}-${Mo}-${D}`; // all-day date
  if (z === "Z") return new Date(Date.UTC(+Y, +Mo - 1, +D, +h, +mi, +s)).toISOString();
  return `${Y}-${Mo}-${D}T${h}:${mi}:${s}`; // floating / TZID — wall-clock time
}
function parseIcs(text) {
  const unfolded = String(text).replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  const out = [];
  let cur = null;
  for (const line of unfolded.split("\n")) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") { if (cur) out.push(cur); cur = null; continue; }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const name = line.slice(0, idx).split(";")[0].toUpperCase();
    const val = line.slice(idx + 1);
    if (name === "DTSTART") cur.start = parseIcsDate(val);
    else if (name === "DTEND") cur.end = parseIcsDate(val);
    else if (name === "SUMMARY") cur.summary = unescapeText(val);
    else if (name === "LOCATION") cur.location = unescapeText(val);
    else if (name === "STATUS") cur.status = val;
    else if (name === "UID") cur.uid = val;
    else if (name === "DESCRIPTION") cur.description = unescapeText(val);
  }
  return out.map((e) => ({
    uid: e.uid || "", start: e.start || null, end: e.end || null,
    summary: e.summary || "", location: e.location || "", status: e.status || "",
    ...parseAgent(e.description || ""),
  }));
}

// Pull the showing agent's name / brokerage / phone / email out of the description.
function parseAgent(desc) {
  const lines = String(desc).split("\n").map((l) => l.trim());
  let agent = "", broker = "", email = "", phone = "";
  const idx = lines.findIndex((l) => /agent\s*:?\s*$/i.test(l));
  if (idx >= 0) {
    const after = lines.slice(idx + 1).filter(Boolean);
    if (after[0] && !/@/.test(after[0]) && !/\d{3}\D*\d{4}/.test(after[0])) agent = after[0];
    if (after[1] && !/@/.test(after[1]) && !/\d{3}\D*\d{4}/.test(after[1])) broker = after[1];
  }
  const em = lines.find((l) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l));
  if (em) email = em;
  for (const l of lines) {
    const m = l.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
    if (m) { phone = m[0]; break; }
  }
  return { agent, broker, email, phone };
}

// Stable per-showing key: prefer the calendar UID; otherwise fall back to
// start-time + summary. Must stay in sync with the client's showingKey() so
// saved leads (keyed the same way) keep matching their row.
const showingKey = (e) => e.uid || `${e.start || ""}|${e.summary || ""}`;

// ── New-showing watcher ───────────────────────────────────────────────────────
// Compares the live ShowingTime feed against the set of showings we've already
// seen (app_settings id "showing_watch"); anything new triggers a notification.
// Recipients come from app_settings id "showing_alerts" {recipients:[names]} —
// empty/missing = admins only. Throttled to one real check per 4 minutes; the
// very first run seeds the seen-set silently so history never blasts phones.
export async function checkNewShowings(feed = null) {
  try {
    const db = admin();
    const { data: row } = await db.from("app_settings").select("data").eq("id", "showing_watch").maybeSingle();
    const st = (row && row.data) || {};
    const now = Date.now();
    if (st.lastCheck && now - new Date(st.lastCheck).getTime() < 4 * 60 * 1000) return { skipped: true };
    const data = feed || await fetchShowings();
    if (!data || !Array.isArray(data.showings)) return { skipped: true };
    // NEVER key on the calendar UID — ShowingTime regenerates every UID on each
    // feed export, which made every showing look "new" again and re-alerted.
    // Time + property + agent survives exports. (Stored under seen2 so the old
    // uid-keyed set is abandoned; the switchover seeds once, silently.)
    const keyOf = (x) => `${x.start || ""}|${String(x.location || x.summary || "").slice(0, 60)}|${x.agent || ""}`.toLowerCase();
    const first = !Array.isArray(st.seen2);
    const seen = new Set(st.seen2 || []);
    const fresh = data.showings.filter((x) => !seen.has(keyOf(x)));
    const merged = [...new Set([...(st.seen2 || []), ...data.showings.map(keyOf)])].slice(-2000);
    await db.from("app_settings").upsert({ id: "showing_watch", data: { seen2: merged, lastCheck: new Date(now).toISOString() }, updated_at: new Date().toISOString() });
    if (first || !fresh.length) return { seeded: first, fresh: 0 };
    const { data: cfgRow } = await db.from("app_settings").select("data").eq("id", "showing_alerts").maybeSingle();
    const names = (cfgRow && cfgRow.data && cfgRow.data.recipients) || [];
    // Only genuinely upcoming showings deserve a ping (skip stale/past entries).
    const upcoming = fresh.filter((x) => { const t = x.start ? new Date(x.start).getTime() : 0; return t > now - 3600000; });
    const { notifyFanout } = await import("./notify.js");
    // ShowingTime writes wall-clock times with no timezone ("2026-07-22T17:20:00"
    // meaning 5:20 PM local). Print those verbatim (format in UTC after pinning
    // them AS UTC) — converting them to Eastern shifted every time by -4h.
    const fmtWhen = (iso) => {
      if (!iso) return "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) { const d = new Date(iso + "T12:00:00Z"); return d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }); }
      const hasZone = /[zZ]$|[+\-]\d{2}:?\d{2}$/.test(iso);
      const d = new Date(hasZone ? iso : iso + "Z");
      if (isNaN(d.getTime())) return "";
      return d.toLocaleString("en-US", { timeZone: hasZone ? "America/New_York" : "UTC", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    };
    for (const x of upcoming.slice(0, 6)) {
      const when = fmtWhen(x.start);
      await notifyFanout(db, null, {
        ...(names.length ? { recipients: names } : { toAdmins: true }),
        title: "\ud83d\udcc5 New showing scheduled",
        body: `${x.location || x.summary || "A property"}${when ? ` \u2014 ${when}` : ""}${x.agent ? ` \u00b7 ${x.agent}` : ""}`,
        tag: `shownew-${keyOf(x).replace(/[^a-z0-9|]/g, "")}`.slice(0, 64),
        url: "/?goto=showings",
      }).catch(() => {});
    }
    return { fresh: upcoming.length };
  } catch (e) {
    console.error("[showings/watch]", e.message);
    return { error: e.message };
  }
}

export async function fetchShowings() {
  const url = await getIcsUrl();
  if (!url) return { configured: false, showings: [] };
  const httpUrl = url.replace(/^webcal:\/\//i, "https://");
  const r = await fetch(httpUrl, { headers: { Accept: "text/calendar" } });
  if (!r.ok) throw new Error(`ShowingTime feed request failed (${r.status}).`);
  const text = await r.text();
  // Return the live feed, de-duped by stable key (uid, or start+summary) in case
  // the feed ever repeats an event. Leads are keyed to these same ids on the
  // property, so they line up. (No server-side merge/store — that caused dupes.)
  const map = new Map();
  for (const e of parseIcs(text)) map.set(showingKey(e), e);
  return { configured: true, showings: [...map.values()] };
}
