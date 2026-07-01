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
    summary: e.summary || "", location: e.location || "", status: e.status || "", description: e.description || "",
  }));
}

export async function fetchShowings() {
  const url = await getIcsUrl();
  if (!url) return { configured: false, showings: [] };
  const httpUrl = url.replace(/^webcal:\/\//i, "https://");
  const r = await fetch(httpUrl, { headers: { Accept: "text/calendar" } });
  if (!r.ok) throw new Error(`ShowingTime feed request failed (${r.status}).`);
  const text = await r.text();
  return { configured: true, showings: parseIcs(text) };
}
