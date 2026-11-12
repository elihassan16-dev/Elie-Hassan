// 📱 Text-message lookups for the Claude connector (recent_texts + the fuzzy
// get_texts "with"): which rows a teammate may see, read/unread, saved names,
// and forgiving New York date/time parsing ("yesterday 3pm", "48 hours",
// "2026-11-10", "Nov 10 9:30am").
//
// "Your own line" (Elie 11/12/26) = rows whose business line (row.from) is the
// teammate's own number from JIVETEL_NUMBERS, or a shared line that isn't any
// one teammate's (the office / master number). Old rows with no line recorded
// count only when the teammate texted that number themself.
import { e164, sameFirst, resolveSender } from "./jivetel.js";

const NY = "America/New_York";
export const last10 = (x) => String(x || "").replace(/\D/g, "").slice(-10);

// Floating NY wall-clock parts → epoch ms.
export function nyPartsToMs(y, mo, d, h = 0, mi = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: NY, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const asNy = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return guess - (asNy - guess);
}
const nyToday = (ms = Date.now()) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: NY, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return { y: +p.year, mo: +p.month, d: +p.day }; };
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// → { ms, hasTime } or null. end=true: a date with no time means the END of that day.
export function parseWhen(v, { end = false, now = Date.now() } = {}) {
  const s0 = String(v == null ? "" : v).trim().toLowerCase();
  if (!s0) return null;
  if (s0 === "now") return { ms: now, hasTime: true };
  // relative: "24 hours", "3 days ago", "90 min", "2w"
  let m = /^(\d+(?:\.\d+)?)\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?|w|wks?|weeks?)(\s+ago)?$/.exec(s0);
  if (m) { const n = Number(m[1]), u = m[2][0]; return { ms: now - n * (u === "m" ? 60000 : u === "h" ? 3600000 : u === "d" ? 86400000 : 7 * 86400000), hasTime: true }; }
  // ISO with a zone → exact
  if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}.*(z|[+-]\d{2}:?\d{2})$/.test(s0)) { const t = Date.parse(v); return isNaN(t) ? null : { ms: t, hasTime: true }; }
  // ISO date / floating date-time = New York wall clock
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{2}):(\d{2}))?$/.exec(s0);
  if (m) return m[4] != null ? { ms: nyPartsToMs(+m[1], +m[2], +m[3], +m[4], +m[5]), hasTime: true } : { ms: nyPartsToMs(+m[1], +m[2], +m[3]) + (end ? 86400000 - 1 : 0), hasTime: false };
  // words: today / yesterday / "nov 10" / "11/10" / weekday + optional "3pm" / "15:30"
  let s = s0, h = null, mi = 0;
  const tm = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)\b|\b(\d{1,2}):(\d{2})\b/.exec(s);
  if (tm) {
    if (tm[3]) { h = Number(tm[1]) % 12 + (tm[3][0] === "p" ? 12 : 0); mi = Number(tm[2] || 0); }
    else { h = Number(tm[4]); mi = Number(tm[5]); }
    s = (s.slice(0, tm.index) + " " + s.slice(tm.index + tm[0].length)).replace(/\b(at|around|about)\b/g, " ").trim();
  }
  let day = null;
  const t = nyToday(now);
  if (!s || s === "today") day = t;
  else if (s === "yesterday") day = nyToday(now - 86400000);
  else if ((m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s))) day = { y: m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : t.y, mo: +m[1], d: +m[2] };
  else if ((m = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?$/.exec(s)) && MONTHS.includes(m[1])) day = { y: m[3] ? +m[3] : t.y, mo: MONTHS.indexOf(m[1]) + 1, d: +m[2] };
  else {
    const wd = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].findIndex((w) => s.startsWith(w) || s === `last ${w}` || s.startsWith(`last ${w}`));
    if (wd >= 0) { for (let k = 1; k <= 7; k++) { const c = nyToday(now - k * 86400000); const dow = new Date(Date.UTC(c.y, c.mo - 1, c.d)).getUTCDay(); if (dow === wd) { day = c; break; } } }
  }
  if (!day) { const p = Date.parse(v); return isNaN(p) ? null : { ms: p, hasTime: /\d:\d|am|pm/i.test(String(v)) }; }
  if (h != null) return { ms: nyPartsToMs(day.y, day.mo, day.d, h, mi), hasTime: true };
  return { ms: nyPartsToMs(day.y, day.mo, day.d) + (end ? 86400000 - 1 : 0), hasTime: false };
}

// The teammate's own business line + every teammate's line (so a shared line is
// one that belongs to nobody).
export function linesFor(me) {
  let numbers = {};
  try { numbers = JSON.parse(process.env.JIVETEL_NUMBERS || "{}"); } catch { /* none */ }
  const user = { id: me.id, email: me.email, user_metadata: { name: me.name } };
  const r = resolveSender(user, me.name, me.name);
  const mine = r.person ? e164(r.from || "") : ""; // no line of their own → shared lines only
  const personal = new Set(Object.values(numbers).map((x) => e164(x)).filter(Boolean));
  return { mine, personal };
}

// Text rows (calls excluded) between two times, newest first.
export async function loadTexts(db, { sinceMs = 0, untilMs = Date.now(), max = 6000 } = {}) {
  let q = db.from("sms_messages").select("phone,data");
  if (sinceMs) q = q.gte("data->>at", new Date(sinceMs).toISOString());
  if (untilMs) q = q.lte("data->>at", new Date(untilMs).toISOString());
  const { data, error } = await q.limit(max);
  if (error) throw new Error(`Couldn't read texts: ${error.message}`);
  return (data || []).map((r) => ({ ...(r.data || {}), phone: e164(r.phone || (r.data || {}).phone) }))
    .filter((m) => m.phone && m.at && m.kind !== "call")
    .filter((m) => { const t = Date.parse(m.at); return !isNaN(t) && (!sinceMs || t >= sinceMs) && (!untilMs || t <= untilMs); })
    .sort((x, y) => String(y.at).localeCompare(String(x.at)));
}

// Keep the rows on the teammate's own line (+ shared lines). Old rows with no
// line recorded: only numbers the teammate texted.
export function ownLine(rows, me) {
  const { mine, personal } = linesFor(me);
  const textedByMe = new Set(rows.filter((m) => String(m.direction).startsWith("out") && sameFirst(m.by, me.name)).map((m) => m.phone));
  return rows.filter((m) => {
    const line = e164(m.from || "");
    if (line) return line === mine || !personal.has(line);
    return textedByMe.has(m.phone) || (String(m.direction).startsWith("out") && sameFirst(m.by, me.name));
  });
}

export async function readMapFor(db, me) {
  const { data } = await db.from("app_settings").select("data").eq("id", `uprefs_${me.id}`).maybeSingle();
  return ((data && data.data) || {}).smsRead || {};
}
export async function savedNames(db) {
  const { data } = await db.from("contacts").select("data");
  const map = new Map();
  for (const c of (data || []).map((r) => r.data).filter(Boolean)) for (const ph of [...(c.phones || []).map((p) => p && p.number), c.phone]) { const k = last10(ph); if (k.length === 10 && !map.has(k)) map.set(k, c.name); }
  return map;
}
export const nyStamp = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: NY, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const prettyPhone = (p) => { const d = last10(p); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(p || ""); };
