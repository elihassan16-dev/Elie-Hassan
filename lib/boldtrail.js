// BoldTrail (formerly kvCORE) buyer-lead sync. Server-side only — the API
// token lives in Vercel env (BOLDTRAIL_API_TOKEN) and never reaches the browser.
// Pulls contacts, keeps the ones Elie wants (Type: Buyer with a propertyBoost
// "pb<address>" hashtag), stores them in bt_leads for the app to render inside
// each property's Showings section, and pings the admins about fresh ones.
// The exact kvCORE response shape isn't publicly documented, so fetching
// probes a few known endpoint variants and normalizes fields defensively;
// /api/boldtrail/status reports what the API actually returned.
import { createClient } from "@supabase/supabase-js";

const BASE = "https://api.kvcore.com";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const svc = () => createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

export const btToken = () => process.env.BOLDTRAIL_API_TOKEN || process.env.KVCORE_API_TOKEN || "";

// Endpoint × auth-style probe matrix. kvCORE's docs are gated; 404s mean
// wrong path, 401s mean the path exists but the handshake (or token) is off —
// so we try Bearer AND raw-token headers, and surface the API's own error
// message so the status page shows exactly what BoldTrail said.
const CANDIDATE_PATHS = [
  "/v2/public/contacts?limit=100",
  "/v2/public/contacts",
  "/contacts?limit=100",
  "/v2/contacts?limit=100",
  "/v1/contacts?limit=100",
  "/api/v2/public/contacts?limit=100",
];
const AUTH_STYLES = [
  { name: "bearer", headers: (t) => ({ Authorization: `Bearer ${t}` }) },
  { name: "raw", headers: (t) => ({ Authorization: t }) },
  { name: "x-api-key", headers: (t) => ({ "X-Api-Key": t }) },
];
let working = null; // {path, auth} memoized per warm instance

async function tryFetch(path, auth) {
  const r = await fetch(`${BASE}${path}`, { headers: { ...auth.headers(btToken()), Accept: "application/json", "Content-Type": "application/json" } });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch { /* non-JSON body */ }
  const arr = j && (Array.isArray(j.data) ? j.data : Array.isArray(j.contacts) ? j.contacts : Array.isArray(j) ? j : null);
  return { ok: r.ok && !!arr, status: r.status, arr, body: String(text || "").slice(0, 140), sample: arr && arr[0] ? Object.keys(arr[0]).slice(0, 40) : [] };
}

export async function fetchContacts() {
  const token = btToken();
  if (!token) return { configured: false };
  const tried = [];
  const combos = working ? [working] : [];
  for (const p of CANDIDATE_PATHS) for (const a of AUTH_STYLES) if (!combos.some((c) => c.path === p && c.auth.name === a.name)) combos.push({ path: p, auth: a });
  for (const c of combos) {
    try {
      const r = await tryFetch(c.path, c.auth);
      tried.push({ path: c.path.split("?")[0], auth: c.auth.name, status: r.status, ok: r.ok, msg: r.ok ? undefined : r.body });
      if (r.ok) { working = c; return { configured: true, ok: true, path: c.path.split("?")[0], auth: c.auth.name, contacts: r.arr, sample: r.sample, tried }; }
    } catch (e) { tried.push({ path: c.path.split("?")[0], auth: c.auth.name, error: e.message }); }
  }
  return { configured: true, ok: false, tokenLength: token.length, tokenLooksJwt: /^eyJ/.test(token) && token.split(".").length === 3, tried };
}

const digits = (x) => String(x || "").replace(/\D/g, "");
const val = (c, keys) => { for (const k of keys) { const v = c && c[k]; if (v != null && String(v).trim()) return String(v).trim(); } return ""; };
const tagsOf = (c) => {
  const raw = c && (c.hashtags ?? c.tags ?? c.hashtag);
  if (Array.isArray(raw)) return raw.map((t) => (typeof t === "string" ? t : (t && (t.name || t.tag || t.title)) || "")).filter(Boolean);
  if (typeof raw === "string") return raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  return [];
};

export function normalizeContact(c) {
  const phone = val(c, ["cell_phone_1", "cell_phone_2", "cell_phone", "phone", "phone_number", "mobile", "home_phone", "work_phone"]);
  return {
    id: String(c.id ?? c.contact_id ?? c.uuid ?? digits(phone) ?? ""),
    name: (val(c, ["name", "full_name"]) || `${val(c, ["first_name", "firstname", "first"])} ${val(c, ["last_name", "lastname", "last"])}`).trim(),
    phone,
    email: val(c, ["email", "email_address", "primary_email"]),
    type: val(c, ["deal_type", "type", "contact_type", "lead_type"]),
    status: val(c, ["status", "stage"]),
    tags: tagsOf(c),
    createdAt: val(c, ["created_at", "created", "insert_dt", "added"]),
  };
}

// The leads Elie wants: buyers who expressed interest in a property —
// recognizable by the propertyBoost "pb<address>" hashtag.
export const hasPbTag = (tags) => (tags || []).some((t) => /^pb./i.test(String(t).trim()));
export const isPropertyBuyerLead = (n) => /buyer/i.test(n.type || "") && hasPbTag(n.tags);

// One contact's full record (the list omits hashtags — details carry them).
export async function fetchContactDetail(id) {
  if (!working) return null;
  const base = working.path.split("?")[0];
  try {
    const r = await fetch(`${BASE}${base}/${encodeURIComponent(id)}`, { headers: { ...working.auth.headers(btToken()), Accept: "application/json" } });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) return null;
    return (j.data && !Array.isArray(j.data)) ? j.data : j;
  } catch { return null; }
}

export async function syncBoldtrail() {
  const res = await fetchContacts();
  if (!res.configured || !res.ok) return res;
  const db = svc();
  // Walk the pages (100 per page; ~701 contacts → a handful of requests).
  const all = [...res.contacts];
  for (let pg = 2; pg <= 10; pg++) {
    try {
      const sep = working.path.includes("?") ? "&" : "?";
      const r = await tryFetch(`${working.path}${sep}page=${pg}`, working.auth);
      if (!r.ok || !r.arr || !r.arr.length) break;
      if (String(r.arr[0] && r.arr[0].id) === String(all[0] && all[0].id)) break; // no pagination support
      all.push(...r.arr);
      if (r.arr.length < 100) break;
    } catch { break; }
  }
  const buyers = all.map(normalizeContact).filter((n) => n.id && /buyer/i.test(n.type || ""));
  if (!buyers.length) return { ok: true, buyers: 0, fresh: 0 };
  const ids = buyers.map((l) => "bt_" + l.id);
  const { data: existing } = await db.from("bt_leads").select("id").in("id", ids);
  const have = new Set((existing || []).map((r) => r.id));
  const newOnes = buyers.filter((l) => !have.has("bt_" + l.id));
  // The list omits hashtags, so fetch each NEW buyer's detail once (bounded per
  // sync; leftovers get picked up next pass). Non-pb buyers are stored hidden so
  // they're never re-checked — the app only shows rows with a pb property tag.
  const fresh = [];
  for (const l of newOnes.slice(0, 40)) {
    const det = await fetchContactDetail(l.id);
    const dn = det ? normalizeContact(det) : null;
    const tags = det ? tagsOf(det) : [];
    const merged = {
      id: l.id,
      name: (dn && dn.name) || l.name, phone: (dn && dn.phone) || l.phone, email: (dn && dn.email) || l.email,
      type: (dn && dn.type) || l.type, status: (dn && dn.status) || l.status,
      tags, createdAt: (dn && dn.createdAt) || l.createdAt,
      hidden: !hasPbTag(tags),
    };
    await db.from("bt_leads").upsert({ id: "bt_" + l.id, phone: digits(merged.phone), data: merged, updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (!merged.hidden) fresh.push(merged);
  }
  // Only ping about small batches (a real trickle) — the first backlog import
  // stays quiet.
  if (fresh.length && fresh.length <= 12) {
    const { notifyFanout } = await import("./notify.js");
    for (const l of fresh) {
      const tag = String((l.tags || []).find((t) => /^pb./i.test(t)) || "").replace(/^pb/i, "");
      const nice = tag.replace(/([a-z])([A-Z0-9])/g, "$1 $2");
      await notifyFanout(db, null, {
        toAdmins: true,
        title: "🔥 New buyer lead (BoldTrail)",
        body: `${l.name || "Someone"}${nice ? ` — interested in ${nice}` : ""}${l.phone ? ` · ${l.phone}` : ""}`,
        tag: `btlead-${l.id}`.slice(0, 64),
        url: "/?goto=showings",
      }).catch(() => {});
    }
  }
  return { ok: true, buyers: buyers.length, checked: newOnes.length, fresh: fresh.length };
}
