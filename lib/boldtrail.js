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

// One contact's full record / hashtags. The list omits hashtags and the plain
// /{id} path 404'd live, so this probes several likely detail addresses and
// memoizes the first that answers (preferring one that actually yields tags).
// Live probing found the contact record at the SINGULAR /contact/{id} (200)
// — but hashtags aren't among its fields, so tag-specific side doors follow.
const DETAIL_VARIANTS = [
  (base, id) => `/v2/public/contact/${id}`,
  (base, id) => `/v2/public/contact/${id}/hashtags`,
  (base, id) => `/v2/public/contact/${id}?include=hashtags`,
  (base, id) => `/v2/public/contact/${id}/tags`,
  (base, id) => `/v2/public/hashtags?contact_id=${id}`,
  (base, id) => `/v2/public/contact/${id}/hashtag`,
];
let workingDetail = null; // index into DETAIL_VARIANTS, memoized per warm instance

async function rawGet(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { ...working.auth.headers(btToken()), Accept: "application/json" } });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch { /* non-JSON */ }
  return { ok: r.ok && j != null, status: r.status, j, body: String(text || "").slice(0, 140) };
}

const interpretDetail = (j) => {
  const obj = (j && j.data !== undefined) ? j.data : j;
  if (Array.isArray(obj)) {
    // a bare hashtags array (the /hashtags subresource shape)
    const tags = obj.map((t) => (typeof t === "string" ? t : (t && (t.name || t.tag || t.title || t.hashtag)) || "")).filter(Boolean);
    return { det: null, tags };
  }
  if (obj && typeof obj === "object") return { det: obj, tags: tagsOf(obj) };
  return { det: null, tags: [] };
};

export async function getContactTags(id) {
  if (!working) return { ok: false };
  const base = working.path.split("?")[0];
  let det = null, tags = [];
  const order = workingDetail != null ? [workingDetail, ...DETAIL_VARIANTS.keys()].filter((v, i, a) => a.indexOf(v) === i) : [...DETAIL_VARIANTS.keys()];
  for (const i of order) {
    try {
      const r = await rawGet(DETAIL_VARIANTS[i](base, encodeURIComponent(id)));
      if (!r.ok) continue;
      const out = interpretDetail(r.j);
      if (out.det && !det) det = out.det;
      if (out.tags.length) { workingDetail = i; return { ok: true, det: det || out.det, tags: out.tags, tagsConfirmed: true }; }
      // The memoized tag door answered with an explicit (empty) tags list —
      // that's a real "no hashtags", not a missing source.
      if (workingDetail === i && r.j && (r.j.tags !== undefined || (r.j.data && r.j.data.tags !== undefined)))
        return { ok: true, det, tags: [], tagsConfirmed: true };
    } catch { /* try next */ }
  }
  // Record found but no tag source yet — caller must NOT treat this as "no pb
  // tag"; the hashtag door simply hasn't been located.
  return det ? { ok: true, det, tags, tagsConfirmed: false } : { ok: false };
}

// Status-page probe: every variant's outcome for one contact, tags included.
export async function probeDetail(id) {
  if (!working) return [{ error: "list endpoint not resolved" }];
  const base = working.path.split("?")[0];
  const out = [];
  for (const make of DETAIL_VARIANTS) {
    const path = make(base, encodeURIComponent(id));
    try {
      const r = await rawGet(path);
      const d = r.ok ? interpretDetail(r.j) : null;
      out.push({ path: path.replace(String(id), "{id}"), status: r.status, ok: r.ok, tags: d ? d.tags.length : undefined, tagValuesRedacted: d && d.tags.length ? d.tags.map((t) => String(t).slice(0, 4) + "…") : undefined, fields: d && d.det ? Object.keys(d.det) : undefined, msg: r.ok ? undefined : r.body });
    } catch (e) { out.push({ path: path.replace(String(id), "{id}"), error: e.message }); }
  }
  return out;
}

// Counts-only snapshot of what the sync has stored — for the status page.
// Never returns names/phones; just totals and how many carry a pb tag.
export async function storedLeadStats() {
  try {
    const db = svc();
    const { data, error } = await db.from("bt_leads").select("data");
    if (error) return { error: error.message };
    const rows = data || [];
    const withPb = rows.filter((r) => hasPbTag((r.data || {}).tags)).length;
    const hidden = rows.filter((r) => (r.data || {}).hidden).length;
    // Mirror the app's tag↔address matcher so the status page can say whether
    // stored leads actually line up with properties. Redacted prefixes only.
    const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^(\d+)(south|north|east|west|s|n|e|w)(?=\d)/, "$1");
    const pbOf = (r) => { const t = ((r.data || {}).tags || []).map(String).find((x) => /^pb./i.test(x.trim())); return t ? norm(t.trim().replace(/^pb/i, "")) : ""; };
    const { data: props } = await db.from("properties").select("address").in("status", ["On Market", "In Closing"]);
    const addrs = (props || []).map((x) => norm(x.address)).filter((x) => x.length >= 5);
    const matches = (a) => a.length >= 5 && addrs.some((b) => a.startsWith(b) || b.startsWith(a));
    const tagCounts = {};
    rows.forEach((r) => { const a = pbOf(r); if (!a) return; const k = a.slice(0, 6) + "…"; tagCounts[k] = (tagCounts[k] || 0) + 1; });
    const matched = rows.filter((r) => !(r.data || {}).hidden && matches(pbOf(r))).length;
    return {
      total: rows.length, visible: rows.length - hidden, hidden, withPbTag: withPb,
      properties: addrs.length, matchedToAProperty: matched,
      tagPrefixes: tagCounts, addrPrefixes: addrs.map((a) => a.slice(0, 6) + "…"),
    };
  } catch (e) { return { error: e.message }; }
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
  // Elie only wants buyers for ACTIVE listings — everything else he sold long
  // ago. A buyer is visible only when its pb tag matches an On Market /
  // In Closing property; all others are stored hidden purely so the importer
  // never re-downloads them.
  const normA = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^(\d+)(south|north|east|west|s|n|e|w)(?=\d)/, "$1");
  const { data: actProps } = await db.from("properties").select("address").in("status", ["On Market", "In Closing"]);
  const actAddrs = (actProps || []).map((x) => normA(x.address)).filter((x) => x.length >= 5);
  const matchesActive = (tags) => {
    const t = String((tags || []).find((x) => /^pb./i.test(String(x).trim())) || "").trim().replace(/^pb/i, "");
    const a = normA(t);
    return a.length >= 5 && actAddrs.some((b) => a.startsWith(b) || b.startsWith(a));
  };
  // Re-aim already-stored rows at the CURRENT active listings each pass:
  // buyers for a deal that sold disappear from the app; buyers for a listing
  // that just went active pop in. Bounded per pass to stay inside the timeout.
  const { data: allRows } = await db.from("bt_leads").select("id,data");
  let flips = 0;
  for (const r of allRows || []) {
    if (flips >= 60) break;
    const d = r.data || {};
    const want = hasPbTag(d.tags) && matchesActive(d.tags);
    if (want === !d.hidden) continue;
    await db.from("bt_leads").update({ data: { ...d, hidden: !want }, updated_at: new Date().toISOString() }).eq("id", r.id);
    flips++;
  }
  // The list omits hashtags, so fetch each NEW buyer's detail once (bounded per
  // sync; leftovers get picked up next pass). Non-pb buyers are stored hidden so
  // they're never re-checked — the app only shows rows with a pb property tag.
  // One-time self-heal: earlier passes stored buyers as hidden with no tags
  // while the hashtag source was still missing — wipe those so they re-process.
  const dbErrs = [];
  const heal = await db.from("bt_leads").delete().filter("data->>hidden", "eq", "true").filter("data->tags", "eq", "[]");
  if (heal.error) dbErrs.push("heal: " + heal.error.message);
  const fresh = [];
  // The list omits hashtags, so each buyer needs one detail call — the slow
  // part. Run the lookups several at a time (bounded concurrency) so a pass
  // clears a few hundred instead of a few dozen.
  const batch = newOnes.slice(0, 250);
  const CONC = 8;
  const started = Date.now();
  for (let i = 0; i < batch.length; i += CONC) {
    if (Date.now() - started > 42000) break; // leave headroom inside the 60s window
    const part = batch.slice(i, i + CONC);
    const infos = await Promise.all(part.map((l) => getContactTags(l.id).then((info) => ({ l, info })).catch(() => ({ l, info: { ok: false } }))));
    await Promise.all(infos.map(async ({ l, info }) => {
      if (!info.ok) return; // lookup failed — leave unprocessed so next pass retries
      if (!info.tagsConfirmed) return; // hashtag source not located yet — do not classify
      const det = info.det, tags = info.tags;
      const dn = det ? normalizeContact(det) : null;
      const merged = {
        id: l.id,
        name: (dn && dn.name) || l.name, phone: (dn && dn.phone) || l.phone, email: (dn && dn.email) || l.email,
        type: (dn && dn.type) || l.type, status: (dn && dn.status) || l.status,
        tags, createdAt: (dn && dn.createdAt) || l.createdAt,
        hidden: !(hasPbTag(tags) && matchesActive(tags)),
      };
      const w = await db.from("bt_leads").upsert({ id: "bt_" + l.id, phone: digits(merged.phone), data: merged, updated_at: new Date().toISOString() }, { onConflict: "id" });
      if (w.error) { if (dbErrs.length < 4) dbErrs.push("upsert: " + w.error.message); return; }
      if (!merged.hidden) fresh.push(merged);
    }));
  }
  // Only ping about small batches (a real trickle) — the first backlog import
  // stays quiet. fresh already contains only buyers for active listings.
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
  const { count: dbCount } = await db.from("bt_leads").select("id", { count: "exact", head: true });
  return { ok: true, buyers: buyers.length, checked: newOnes.length, fresh: fresh.length, dbCount: dbCount ?? null, dbErrors: dbErrs.length ? dbErrs : undefined };
}
