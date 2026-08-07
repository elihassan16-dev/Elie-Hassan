// Shared Jivetel texting helpers — server-side only (service role).
// The conversation store is the same sms_messages table the app has always
// read (so old conversations survive engine changes); these helpers write
// rows in that shape and answer who a signed-in user is.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function e164(n) {
  const d = String(n || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return d ? "+" + d : "";
}

// Store one message row (service role — bypasses RLS; the team reads via RLS).
// Upsert by id: the send endpoint and the inbound webhook can both log the
// same message without doubling it.
export async function storeSms(row) {
  if (!SERVICE_ROLE) return;
  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  await db.from("sms_messages").upsert(
    { id: String(row.id), phone: row.phone || "", data: row, updated_at: new Date().toISOString() },
    { onConflict: "id" }
  );
}

// First-name matching, tolerant of spelling drift ("Esti" vs "Estie"): equal
// first names match, and so do ones where one is the other's prefix (3+
// letters, so "Mo" never grabs "Moshe" by accident from a stray initial).
export const firstName = (s) => String(s || "").trim().toLowerCase().split(/[\s@]+/)[0];
export const sameFirst = (a, b) => {
  a = firstName(a); b = firstName(b);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a));
};

// The auth login often has no display name stored — the app's users table
// always does, and it also carries the role (contractors never get the
// business texting/calling lines).
export async function profileOf(userId) {
  try {
    if (!SERVICE_ROLE || !userId) return null;
    const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data } = await db.from("users").select("name,role").eq("id", userId).maybeSingle();
    return data || null;
  } catch { return null; }
}

// ── Who is this number? ──────────────────────────────────────────────────────
// Names + roles for notifications: BoldTrail buyers, ShowingTime agents (with
// their property), and the Contacts book — cached for 5 minutes.
let _who = { at: 0, map: null };
const _dig = (x) => { const d = String(x || "").replace(/\D/g, ""); return d.length === 11 && d.startsWith("1") ? d.slice(1) : d; };
export async function identifyPhone(phone) {
  const key = _dig(phone);
  if (!key) return null;
  const now = Date.now();
  if (!_who.map || now - _who.at > 5 * 60 * 1000) {
    const map = new Map();
    try {
      if (SERVICE_ROLE) {
        const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
        try { const { data } = await db.from("bt_leads").select("data").limit(3000); (data || []).forEach((r) => { const l = r.data || r; const k = _dig(l.phone); if (k && !map.has(k)) map.set(k, { name: l.name || "", role: "buyer", addr: "" }); }); } catch { /* optional source */ }
        try { const { data } = await db.from("contacts").select("data").limit(3000); (data || []).forEach((r) => { const c = r.data || r; [c.phone, c.phone2, c.cell, c.mobile].forEach((p) => { const k = _dig(p); if (k && !map.has(k)) map.set(k, { name: c.name || c.company || "", role: "contact", addr: "" }); }); }); } catch { /* optional source */ }
      }
      // Agents win: name + which property they showed is the richest label.
      try { const { fetchShowings } = await import("./showings.js"); const d = await fetchShowings(); (d.showings || []).forEach((s) => { String(s.phone || "").split(/[\/,;]| or /i).forEach((p) => { const k = _dig(p); if (k && (s.agent || s.location)) map.set(k, { name: s.agent || "", role: "agent", addr: String(s.location || s.summary || "").split(",")[0] }); }); }); } catch { /* feed down — cache what we have */ }
    } catch { /* label-only helper */ }
    _who = { at: now, map };
  }
  const hit = _who.map.get(key);
  return hit && (hit.name || hit.addr) ? hit : null;
}
export const whoLabel = (w) => w ? `${w.name || "Someone"}${w.role === "buyer" ? " — buyer" : w.role === "agent" ? " — agent" : ""}${w.addr ? ` · ${w.addr}` : ""}` : "";
