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
// Which property does a BoldTrail pb-hashtag point to? Same tolerant matching
// as the app's btMatchesProperty: number + street NAME, suffix/city dropped,
// prefix match either way. Unmatched tags fall back to a prettified tag.
const _STREET = /^(\d+[a-z0-9]{2,}?)(street|avenue|boulevard|boul|road|lane|drive|court|place|terrace|circle|highway|parkway|ave|av|st|rd|blvd|ln|dr|ct|pl|ter|cir|hwy|pkwy|way)/;
const _norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^(\d+)(south|north|east|west|s|n|e|w)(?=\d)/, "$1");
const _core = (x) => { const m = x.match(_STREET); return m ? m[1] : x; };
const btAddr = (tags, props) => {
  const tag = (tags || []).map(String).find((x) => /^pb./i.test(x.trim()));
  if (!tag) return "";
  const raw = tag.trim().replace(/^pb/i, "");
  const a = _core(_norm(raw));
  const hit = a.length >= 5 ? (props || []).find((p) => { const b = _core(_norm(p.address)); return b.length >= 5 && (a.startsWith(b) || b.startsWith(a)); }) : null;
  if (hit) return String(hit.address || "").split(",")[0];
  return raw.replace(/^(\d+)/, "$1 ").replace(/([a-z])([A-Z0-9])/g, "$1 $2").trim();
};
export async function identifyPhone(phone) {
  const key = _dig(phone);
  if (!key) return null;
  const now = Date.now();
  if (!_who.map || now - _who.at > 5 * 60 * 1000) {
    const map = new Map();
    try {
      let propRows = [];
      if (SERVICE_ROLE) {
        const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
        try { const { data } = await db.from("properties").select("data").limit(500); propRows = (data || []).map((r) => r.data || {}); } catch { /* optional source */ }
        // Buyers carry the property their inquiry's pb tag matches.
        try { const { data } = await db.from("bt_leads").select("data").limit(3000); (data || []).forEach((r) => { const l = r.data || r; const k = _dig(l.phone); if (k && !map.has(k)) map.set(k, { name: l.name || "", role: "buyer", addr: btAddr(l.tags, propRows) }); }); } catch { /* optional source */ }
        try { const { data } = await db.from("contacts").select("data").limit(3000); (data || []).forEach((r) => { const c = r.data || r; [c.phone, c.phone2, c.cell, c.mobile].forEach((p) => { const k = _dig(p); if (k && !map.has(k)) map.set(k, { name: c.name || c.company || "", role: "contact", addr: "" }); }); }); } catch { /* optional source */ }
      }
      // Saved showing snapshots keep agents whose showings already left the
      // live feed; the live feed then overwrites with fresher labels.
      try { propRows.forEach((p) => { Object.values(p.showingSnapshots || {}).forEach((sn) => { String(sn.phone || "").split(/[\/,;]| or /i).forEach((ph) => { const k = _dig(ph); if (k && (sn.agent || p.address)) map.set(k, { name: sn.agent || "", role: "agent", addr: String(p.address || "").split(",")[0] }); }); }); }); } catch { /* optional source */ }
      // Numbers the team attached to a showing by hand (property.showingPhones)
      // — the feed had no phone for that agent, so nothing else knows these.
      try { propRows.forEach((p) => { Object.entries(p.showingPhones || {}).forEach(([sk, list]) => { (list || []).forEach((ph) => { const k = _dig(ph); if (!k) return; const sn = (p.showingSnapshots || {})[sk] || null; map.set(k, { name: (sn && sn.agent) || "", role: "agent", addr: String(p.address || "").split(",")[0] }); }); }); }); } catch { /* optional source */ }
      // Agents win: name + which property they showed is the richest label.
      try { const { fetchShowings } = await import("./showings.js"); const d = await fetchShowings(); (d.showings || []).forEach((s) => { String(s.phone || "").split(/[\/,;]| or /i).forEach((p) => { const k = _dig(p); if (k && (s.agent || s.location)) map.set(k, { name: s.agent || "", role: "agent", addr: String(s.location || s.summary || "").split(",")[0] }); }); }); } catch { /* feed down — cache what we have */ }
      // Leads the team typed in by hand (property.customLeads) beat everything
      // — deliberate names, on the exact property they belong to. Same person
      // on several properties → the most recently added one labels them.
      try { const best = new Map(); propRows.forEach((p) => { (p.customLeads || []).forEach((l) => { String(l.phone || "").split(/[\/,;]| or /i).forEach((ph) => { const k = _dig(ph); if (!k || !l.name) return; const at = String(l.at || ""); const prev = best.get(k); if (!prev || at > prev.at) best.set(k, { at, who: { name: l.name, role: l.buyer ? "buyer" : "lead", addr: String(p.address || "").split(",")[0] } }); }); }); }); best.forEach((v, k) => map.set(k, v.who)); } catch { /* optional source */ }
    } catch { /* label-only helper */ }
    _who = { at: now, map };
  }
  const hit = _who.map.get(key);
  return hit && (hit.name || hit.addr) ? hit : null;
}
export const whoLabel = (w) => w ? `${w.name || "Someone"}${w.role === "buyer" ? " — buyer" : w.role === "agent" ? " — agent" : w.role === "lead" ? " — lead" : ""}${w.addr ? ` · ${w.addr}` : ""}` : "";

// ── 🔒 Contact ownership ─────────────────────────────────────────────────────
// The first NON-ESTI team member to reach out (their text, or an outgoing
// call on their line) owns the contact; anyone else needs the owner's OK
// before texting/calling them. Esti reaches out as the agent — she never
// claims a contact and never needs approval. Approvals live in app_settings
// id "contact_approvals" {items:{<e164>:{owner, approved:[names],
// pending:[{by,at,kind}]}}} — the app shows the owner an approve/decline
// banner; approving unlocks that person for that contact permanently.
const OWNER_EXEMPT = ["esti"];
const isExempt = (n) => OWNER_EXEMPT.some((x) => sameFirst(n, x));
const _extToOwner = (ext) => {
  const e = String(ext || "").split("@")[0].trim();
  if (!e) return "";
  for (const [k, v] of Object.entries(process.env)) {
    const m = /^JIVETEL_CALL_EXT_([A-Z0-9]+)$/.exec(k);
    if (m && String(v || "").split("@")[0].trim() === e) return m[1].toLowerCase();
  }
  if (String(process.env.JIVETEL_CALL_EXT || "").split("@")[0].trim() === e) return "elie";
  return "";
};
export async function contactOwner(db, phone) {
  const p = e164(phone);
  if (!p) return "";
  const { data } = await db.from("sms_messages").select("data").eq("phone", p).order("updated_at", { ascending: true }).limit(400);
  for (const r of data || []) {
    const m = r.data || {};
    if (m.direction === "out" && m.kind !== "call" && m.by && !isExempt(m.by)) return String(m.by).trim();
    if (m.direction === "call-out" && m.kind === "call") { const o = _extToOwner(m.ext); if (o && !isExempt(o)) return o; }
  }
  return "";
}
// May senderName reach out to phone? If not: file the approval request (one
// ping to the owner per requester per 4h) and answer {allowed:false, owner}.
export async function checkOutreach(phone, senderName, kind) {
  try {
    if (!SERVICE_ROLE) return { allowed: true };
    const sender = String(senderName || "").trim();
    if (!sender || isExempt(sender)) return { allowed: true };
    const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const owner = await contactOwner(db, phone);
    if (!owner || sameFirst(owner, sender)) return { allowed: true };
    const p = e164(phone);
    const row = (await db.from("app_settings").select("data").eq("id", "contact_approvals").maybeSingle()).data;
    const all = (row && row.data && row.data.items) || {};
    const ent = all[p] || {};
    if ((ent.approved || []).some((x) => sameFirst(x, sender))) return { allowed: true, owner };
    const pend = ent.pending || [];
    const mine = pend.find((q) => sameFirst(q.by, sender));
    if (!mine || Date.now() - new Date(mine.at || 0).getTime() > 4 * 3600000) {
      all[p] = { ...ent, owner, pending: [...pend.filter((q) => !sameFirst(q.by, sender)), { by: sender, at: new Date().toISOString(), kind: kind || "text" }] };
      await db.from("app_settings").upsert({ id: "contact_approvals", data: { items: all }, updated_at: new Date().toISOString() });
      let who = null; try { who = await identifyPhone(p); } catch { /* number-only */ }
      const label = (who && who.name) || p;
      const { notifyFanout } = await import("./notify.js");
      await notifyFanout(db, null, {
        recipientsFirst: [firstName(owner)], pushOnly: true,
        title: `🔒 ${firstName(sender).replace(/^./, (c) => c.toUpperCase())} wants to ${kind === "call" ? "call" : "text"} ${label}`,
        body: `${label} is your contact. Open the app to approve or decline.`,
        tag: `own-${p}`.slice(0, 64), url: "/",
      }).catch(() => {});
    }
    return { allowed: false, owner };
  } catch { return { allowed: true }; } // the gate must never break sending outright
}
// Role + property without the name — for notification bodies where the name
// is already in the title ("(917) 794-5991 · lead · 141 Vanard Dr").
export const whoSub = (w) => w ? [w.role === "buyer" ? "buyer" : w.role === "agent" ? "agent" : w.role === "lead" ? "lead" : "", w.addr || ""].filter(Boolean).join(" · ") : "";
