// 🤖 Server-side email sweeper — the 24/7 half of the auto email matcher.
// Runs in Vercel functions on the 5-minute heartbeat: reads each teammate's
// inbox through Microsoft Graph APPLICATION permissions (client-credentials —
// no one needs the app open), matches emails to properties exactly like the
// in-app sweep (address in subject/preview, or a sender who is a contact
// linked to exactly ONE active property), and auto-pins the chains onto the
// shared property records with an AUTO flag + guessed category label.
//
// Requires (Vercel env): AZURE_CLIENT_SECRET — a client secret for the app
// registration below — and the Mail.Read APPLICATION permission granted with
// admin consent in Azure. Without the secret, sweeps report configured:false
// and do nothing. AZURE_CLIENT_ID / AZURE_TENANT_ID override the defaults.
// MAIL_SWEEP_USERS (JSON array of mailbox addresses) overrides the default
// mailbox list (all non-contractor users).
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TENANT = process.env.AZURE_TENANT_ID || "377dbf92-fa58-4e25-bd42-f96116751c69";
const CLIENT = process.env.AZURE_CLIENT_ID || "8b1ca3b1-7c66-4a1e-958a-c44df9e4cdff";
const SECRET = process.env.AZURE_CLIENT_SECRET || "";
const GRAPH = "https://graph.microsoft.com/v1.0";

function admin() {
  if (!SERVICE_ROLE) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY env var.");
  return createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
}

export const mailSweepConfigured = () => !!(SECRET && SERVICE_ROLE);

// App-only Graph token (client credentials). Cached per warm function instance.
let tok = null; // { access_token, exp }
async function appToken() {
  if (tok && tok.exp > Date.now() + 60000) return tok.access_token;
  const body = new URLSearchParams({
    client_id: CLIENT,
    client_secret: SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const d = await r.json();
  if (!r.ok || !d.access_token) throw new Error(d.error_description || `Token failed (${r.status})`);
  tok = { access_token: d.access_token, exp: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
  return tok.access_token;
}

async function graph(path) {
  const token = await appToken();
  const r = await fetch(path.startsWith("http") ? path : GRAPH + path, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    let msg = `Graph ${r.status}`;
    try { const j = await r.json(); msg = j?.error?.message || msg; } catch { /* keep code */ }
    const err = new Error(msg); err.status = r.status; throw err;
  }
  return r.json();
}

// ── Matching (mirrors the in-app sweep in GoldstoneApp.jsx) ──────────────────
function propAddrTokens(property) {
  const addr = (property.address || "").toLowerCase().trim();
  const num = (addr.match(/^\d+/) || [])[0] || "";
  const STOP = new Set(["rd", "st", "ave", "dr", "ln", "ct", "blvd", "way", "pl", "ter", "road", "street", "avenue", "drive", "lane", "court", "boulevard", "place", "terrace", "cir", "circle"]);
  const words = addr.replace(/^\d+\s*/, "").split(/[\s,]+/).filter((w) => w.length > 2 && !STOP.has(w));
  return { num, words };
}
// Strip an HTML email body down to searchable text (bounded — a giant
// marketing blast shouldn't eat the function's memory).
function bodyText(m) {
  return String((m.body && m.body.content) || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .slice(0, 20000)
    .toLowerCase();
}
const rxEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function chainMatchesProperty(chain, property) {
  const { num, words } = propAddrTokens(property);
  // Match against the FULL body when we have it — most emails bury the
  // address mid-message, not in the subject or opening lines.
  const hay = chain.hay || ((chain.latest.subject || "") + " " + (chain.latest.bodyPreview || "")).toLowerCase();
  // The address must be WRITTEN as an address: house number immediately
  // followed by the street name (optional directional between) — "12 Indian
  // King…", "6 S 4th…". Loose contains-matching pinned "asking/looking" +
  // any stray "12" as 12 Indian King Dr, which flooded that property.
  if (num && words.length) {
    const rx = new RegExp(`(^|[^0-9])${rxEsc(num)}\\s+(?:(?:n|s|e|w|north|south|east|west)\\.?\\s+)?${rxEsc(words[0])}`, "i");
    return rx.test(hay);
  }
  // No house number on file (rare): every street word, on real word boundaries.
  if (!num && words.length >= 2) return words.every((w) => new RegExp(`\\b${rxEsc(w)}\\b`, "i").test(hay));
  return false;
}
function autoMailLabel(m) {
  const s = ((m.subject || "") + " " + (m.bodyPreview || "")).toLowerCase();
  if (/\btitle\b|escrow|settlement|closing disclosure|\bdeed\b|payoff/.test(s)) return "Title";
  if (/\bloan\b|lender|mortgage|appraisal|underwrit|refinanc/.test(s)) return "Lender";
  if (/insurance|\bpolicy\b|premium|coverage|binder/.test(s)) return "Insurance";
  if (/\bquote\b|estimate|proposal|\bbid\b|scope of work/.test(s)) return "Quote";
  if (/permit|township|zoning|inspection|violation|certificate of occupancy/.test(s)) return "Permits";
  if (/utilit|electric bill|gas bill|water bill|sewer|pse&g|jcp&l/.test(s)) return "Utilities";
  return "";
}
function groupChains(items) {
  const byConv = new Map();
  for (const m of items || []) {
    const key = m.conversationId || m.id;
    const text = ((m.subject || "") + " " + (m.bodyPreview || "") + " " + bodyText(m)).toLowerCase();
    const prev = byConv.get(key);
    if (!prev) byConv.set(key, { key, latest: m, hay: text });
    else {
      if ((m.receivedDateTime || "") > (prev.latest.receivedDateTime || "")) prev.latest = m;
      if (prev.hay.length < 60000) prev.hay += " " + text; // every message in the chain is searchable
    }
  }
  return [...byConv.values()];
}
// "Re: Fwd: 18 Fisk St docs" → "18 fisk st docs" — cross-mailbox dedupe: two
// teammates cc'd on one thread see different conversation/message ids, but the
// same normalized subject on the same property is the same paper trail.
const subjKey = (s) => String(s || "").toLowerCase().replace(/^((re|fwd?|aw)\s*:\s*)+/i, "").replace(/\s+/g, " ").trim();

const SELECT = "id,conversationId,internetMessageId,subject,from,receivedDateTime,bodyPreview";

// The team's mailboxes: env override, else every non-contractor user's email.
async function teamMailboxes(db) {
  let mailboxes = [];
  try { mailboxes = JSON.parse(process.env.MAIL_SWEEP_USERS || "[]"); } catch { /* fall through */ }
  if (!mailboxes.length) {
    const { data: users } = await db.from("users").select("email,name,role");
    mailboxes = (users || []).filter((u) => u.email && u.role !== "contractor").map((u) => ({ email: u.email, name: u.name || u.email }));
  } else mailboxes = mailboxes.map((m) => (typeof m === "string" ? { email: m, name: m } : m));
  return mailboxes;
}

// Fetch a pinned chain's full thread from WHICHEVER team mailbox holds it —
// powers the read-only "👁 View" for chains that aren't in the viewer's own
// mailbox. Returns { mailbox: <first name>, messages: [...] } (scripts stripped
// from bodies; the client renders them in a sandboxed iframe regardless).
export async function fetchThreadFromAnyMailbox({ internetMessageId, conversationId }) {
  if (!mailSweepConfigured()) return { unavailable: true, messages: [] };
  const db = admin();
  const mailboxes = await teamMailboxes(db);
  for (const mb of mailboxes) {
    try {
      let convId = null;
      if (internetMessageId) {
        const f = encodeURIComponent(`internetMessageId eq '${String(internetMessageId).replace(/'/g, "''")}'`);
        const d = await graph(`/users/${encodeURIComponent(mb.email)}/messages?$filter=${f}&$select=id,conversationId&$top=1`);
        convId = ((d.value || [])[0] || {}).conversationId || null;
      }
      if (!convId && conversationId) convId = conversationId; // may resolve in this mailbox
      if (!convId) continue;
      const cf = encodeURIComponent(`conversationId eq '${String(convId).replace(/'/g, "''")}'`);
      const d2 = await graph(`/users/${encodeURIComponent(mb.email)}/messages?$filter=${cf}&$select=id,subject,from,receivedDateTime,sentDateTime,body,hasAttachments&$top=50`);
      const items = d2.value || [];
      if (!items.length) continue;
      items.sort((a, b) => String(a.receivedDateTime || a.sentDateTime || "").localeCompare(String(b.receivedDateTime || b.sentDateTime || "")));
      return {
        mailbox: String(mb.name || mb.email).split(" ")[0],
        messages: items.map((m) => ({
          id: m.id,
          subject: m.subject || "",
          at: m.receivedDateTime || m.sentDateTime || "",
          from: (m.from && m.from.emailAddress && (m.from.emailAddress.name || m.from.emailAddress.address)) || "",
          fromAddr: (m.from && m.from.emailAddress && m.from.emailAddress.address) || "",
          hasAttachments: !!m.hasAttachments,
          body: { contentType: (m.body && m.body.contentType) || "html", content: String((m.body && m.body.content) || "").replace(/<script[\s\S]*?<\/script>/gi, "") },
        })),
      };
    } catch { /* try the next mailbox */ }
  }
  return { messages: [] };
}

// Diagnostic: which properties would the matcher pin a given piece of text to?
// (?why=579 coral lane manahawkin → lists matching active + archived addresses.)
export async function whyMatch(text) {
  if (!SERVICE_ROLE) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY env var.");
  const db = admin();
  const { data: rows } = await db.from("properties").select("data");
  const fake = { latest: { subject: "", bodyPreview: "" }, hay: String(text || "").toLowerCase() };
  const all = (rows || []).map((r) => r.data || {});
  return {
    text: String(text || ""),
    matchesActive: all.filter((p) => !p.archived && chainMatchesProperty(fake, p)).map((p) => `${p.address || ""}${p.city ? `, ${p.city}` : ""}`),
    matchesArchived: all.filter((p) => p.archived && chainMatchesProperty(fake, p)).map((p) => `${p.address || ""}${p.city ? `, ${p.city}` : ""}`),
    activeProperties: all.filter((p) => !p.archived).length,
  };
}

// Diagnostic: the state of every Sold-status property (?sold=1) — address,
// selling date, archived, QuickBooks link — plus archived properties under
// OTHER statuses (a this-year sale mis-statused would hide there). Counts and
// addresses only, no financials.
export async function soldAudit() {
  if (!SERVICE_ROLE) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY env var.");
  const db = admin();
  const { data: rows } = await db.from("properties").select("data");
  const all = (rows || []).map((r) => r.data || {});
  const label = (p) => `${p.address || ""}${p.city ? `, ${p.city}` : ""}`;
  return {
    sold: all.filter((p) => p.status === "Sold").map((p) => ({
      address: label(p),
      sellingDate: (p.financials || {}).sellingDate || null,
      archived: !!p.archived,
      qbLinked: !!p.qbProjectId,
    })).sort((a, b) => String(a.sellingDate || "9999").localeCompare(String(b.sellingDate || "9999"))),
    archivedOtherStatus: all.filter((p) => p.archived && p.status !== "Sold").map((p) => ({ address: label(p), status: p.status || "" })),
  };
}

// One-shot cleanup: remove every AUTO pin from every property (hand pins are
// untouched, and nothing is added to autoPinSkip — the next rescan re-pins
// whatever the current matcher still agrees with).
export async function purgeAutoPins() {
  if (!SERVICE_ROLE) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY env var.");
  const db = admin();
  const { data: rows } = await db.from("properties").select("id,data");
  let removed = 0, touched = 0;
  for (const r of rows || []) {
    const pins = (r.data && r.data.pinnedEmails) || [];
    const keep = pins.filter((pe) => !pe.auto);
    if (keep.length === pins.length) continue;
    removed += pins.length - keep.length; touched++;
    await db.from("properties").update({ data: { ...r.data, pinnedEmails: keep } }).eq("id", r.id);
  }
  return { removed, properties: touched };
}

export async function sweepMailboxes({ debug = false, rescan = false } = {}) {
  if (!mailSweepConfigured()) return { configured: false };
  const db = admin();

  // Throttle + per-mailbox watermarks live in app_settings (id EMBEDDED in
  // data — the client's collection loader needs it there). ?rescan=1 wipes the
  // watermarks and skips the throttle: a full fresh 14-day pass right now.
  const { data: row } = await db.from("app_settings").select("data").eq("id", "mail_sweep").maybeSingle();
  const state = (row && row.data) || {};
  const now = Date.now();
  if (!rescan && state.lastRun && now - new Date(state.lastRun).getTime() < 4 * 60 * 1000) return { configured: true, skipped: true };
  const marks = rescan ? {} : { ...(state.marks || {}) };
  const diag = { mailboxes: [], matchedByAddress: {} };

  const mailboxes = await teamMailboxes(db);
  if (!mailboxes.length) return { configured: true, mailboxes: 0 };

  const { data: propRows } = await db.from("properties").select("id,data");
  const props = (propRows || []).map((r) => ({ rowId: r.id, ...(r.data || {}) })).filter((p) => !p.archived);
  const { data: contactRows } = await db.from("contacts").select("id,data");
  const book = (contactRows || []).map((r) => r.data || {});

  // sender email → the one property its linked contact belongs to (null = ambiguous)
  const byEmail = {};
  props.forEach((p) => (p.contacts || []).forEach((cid) => {
    const c = book.find((x) => String(x.id) === String(cid));
    const e = c && c.email ? String(c.email).toLowerCase() : "";
    if (e) byEmail[e] = byEmail[e] === undefined ? p.id : null;
  }));

  let pinsAdded = 0, pinsRefreshed = 0; const errors = [];
  const adds = {}; // property row id -> [pin, ...]
  const upd = {};  // property row id -> [{pinId, set}, ...] — same-subject refreshes
  for (const mb of mailboxes) {
    try {
      const since = marks[mb.email] || new Date(now - 14 * 86400000).toISOString();
      const filter = encodeURIComponent(`receivedDateTime ge ${since}`);
      // Bodies come along so the matcher can read the whole email, and a
      // rescan pages deeper (a 14-day backfill is more than one page).
      let items = [];
      let url = `/users/${encodeURIComponent(mb.email)}/mailFolders/inbox/messages?$filter=${filter}&$select=${SELECT},body&$top=50&$orderby=receivedDateTime desc`;
      const cap = rescan ? 250 : 50;
      while (url && items.length < cap) {
        const d = await graph(url);
        items = items.concat(d.value || []);
        url = d["@odata.nextLink"] || null;
      }
      marks[mb.email] = (items[0] && items[0].receivedDateTime) || new Date(now).toISOString();
      const chains = groupChains(items.filter((m) => String(m.receivedDateTime || "") > since));
      diag.mailboxes.push({ email: mb.email, since, fetched: items.length, newChains: chains.length });
      chains.forEach((ch) => {
        const m = ch.latest;
        const im = m.internetMessageId || "";
        const fromA = String(m.from?.emailAddress?.address || "").toLowerCase();
        // The app's own notification emails (@gpflips.com) name addresses
        // constantly — never auto-pin them.
        if (fromA.endsWith("@gpflips.com")) return;
        const sk = subjKey(m.subject);
        props.forEach((p) => {
          const skip = p.autoPinSkip || [];
          if (skip.includes(ch.key) || (im && skip.includes(im))) return;
          const pinnedNow = [...(p.pinnedEmails || []), ...((adds[p.rowId] || []))];
          if (pinnedNow.some((pe) => (pe.internetMessageId && pe.internetMessageId === im) || pe.conversationId === ch.key)) return;
          // Same subject already pinned here (recurring notifications like
          // "Construction Draw Wire Sent For Loan #…" reuse one subject for
          // every send): don't add a duplicate pin — REFRESH the existing pin
          // to this newer email so the chain always opens the latest one.
          const subjTwin = sk && (p.pinnedEmails || []).find((pe) => subjKey(pe.subject) === sk);
          if (subjTwin) {
            if (String(m.receivedDateTime || "") > String(subjTwin.date || "")) {
              (upd[p.rowId] = upd[p.rowId] || []).push({ pinId: subjTwin.id, set: { conversationId: ch.key, internetMessageId: im, date: m.receivedDateTime || "", preview: m.bodyPreview || "", from: m.from?.emailAddress?.name || fromA, fromAddr: fromA } });
              pinsRefreshed++;
            }
            return;
          }
          if (sk && (adds[p.rowId] || []).some((pe) => subjKey(pe.subject) === sk)) return;
          const senderHit = fromA && byEmail[fromA] != null && String(byEmail[fromA]) === String(p.id);
          if (!senderHit && !chainMatchesProperty(ch, p)) return;
          diag.matchedByAddress[p.address || String(p.id)] = (diag.matchedByAddress[p.address || String(p.id)] || 0) + 1;
          const note = autoMailLabel(m);
          (adds[p.rowId] = adds[p.rowId] || []).push({
            id: `${now}_s${Math.round(Math.random() * 1e6)}`,
            conversationId: ch.key,
            internetMessageId: im,
            subject: m.subject || "",
            from: m.from?.emailAddress?.name || m.from?.emailAddress?.address || "",
            fromAddr: fromA,
            date: m.receivedDateTime || "",
            preview: m.bodyPreview || "",
            auto: true,
            autoBy: String(mb.name || mb.email).split(" ")[0],
            ...(note ? { label: { kind: "general", note } } : {}),
          });
          pinsAdded++;
        });
      });
    } catch (e) { errors.push(`${mb.email}: ${e.message}`); }
  }

  // Write pins property-by-property: re-read the freshest row right before
  // each update and touch ONLY pinnedEmails, so a teammate's concurrent edit
  // elsewhere on the property isn't clobbered.
  for (const rowId of new Set([...Object.keys(adds), ...Object.keys(upd)])) {
    try {
      const { data: fresh } = await db.from("properties").select("data").eq("id", rowId).maybeSingle();
      if (!fresh || !fresh.data) continue;
      let cur = fresh.data.pinnedEmails || [];
      const skip = fresh.data.autoPinSkip || [];
      // Same-subject refreshes first (newest email wins the pin)…
      (upd[rowId] || []).forEach(({ pinId, set }) => {
        cur = cur.map((pe) => (pe.id === pinId && String(set.date || "") > String(pe.date || "") ? { ...pe, ...set } : pe));
      });
      // …then brand-new pins.
      const clean = (adds[rowId] || []).filter((a) => !cur.some((pe) => (pe.internetMessageId && pe.internetMessageId === a.internetMessageId) || pe.conversationId === a.conversationId || (subjKey(a.subject) && subjKey(pe.subject) === subjKey(a.subject))) && !skip.includes(a.conversationId) && !(a.internetMessageId && skip.includes(a.internetMessageId)));
      await db.from("properties").update({ data: { ...fresh.data, pinnedEmails: [...cur, ...clean] } }).eq("id", rowId);
    } catch (e) { errors.push(`save ${rowId}: ${e.message}`); }
  }

  await db.from("app_settings").upsert({ id: "mail_sweep", data: { id: "mail_sweep", lastRun: new Date(now).toISOString(), marks }, updated_at: new Date(now).toISOString() });
  const out = { configured: true, mailboxes: mailboxes.length, pinsAdded, pinsRefreshed, errors: errors.slice(0, 4) };
  // ?debug=1 — counts only (how much was scanned, which addresses matched);
  // never subjects, senders, or content.
  if (debug) out.debug = { properties: props.length, contactsWithEmail: Object.keys(byEmail).length, ...diag };
  return out;
}
