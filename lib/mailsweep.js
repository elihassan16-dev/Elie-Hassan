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
  const r = await fetch(GRAPH + path, { headers: { Authorization: `Bearer ${token}` } });
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
function chainMatchesProperty(chain, property) {
  const { num, words } = propAddrTokens(property);
  if (!words.length && !num) return false;
  const hay = ((chain.latest.subject || "") + " " + (chain.latest.bodyPreview || "")).toLowerCase();
  const numHit = num && hay.includes(num);
  const wordHit = words.some((w) => hay.includes(w));
  return (numHit && wordHit) || (words.length >= 2 && words.every((w) => hay.includes(w)));
}
function autoMailLabel(m) {
  const s = ((m.subject || "") + " " + (m.bodyPreview || "")).toLowerCase();
  if (/\btitle\b|escrow|settlement|closing disclosure|\bdeed\b|payoff/.test(s)) return "Title";
  if (/\bloan\b|lender|mortgage|appraisal|underwrit|refinanc/.test(s)) return "Lender";
  if (/insurance|\bpolicy\b|premium|coverage|binder/.test(s)) return "Insurance";
  if (/permit|township|zoning|inspection|violation|certificate of occupancy/.test(s)) return "Permits";
  if (/utilit|electric bill|gas bill|water bill|sewer|pse&g|jcp&l/.test(s)) return "Utilities";
  return "";
}
function groupChains(items) {
  const byConv = new Map();
  for (const m of items || []) {
    const key = m.conversationId || m.id;
    const prev = byConv.get(key);
    if (!prev) byConv.set(key, { key, latest: m });
    else if ((m.receivedDateTime || "") > (prev.latest.receivedDateTime || "")) prev.latest = m;
  }
  return [...byConv.values()];
}
// "Re: Fwd: 18 Fisk St docs" → "18 fisk st docs" — cross-mailbox dedupe: two
// teammates cc'd on one thread see different conversation/message ids, but the
// same normalized subject on the same property is the same paper trail.
const subjKey = (s) => String(s || "").toLowerCase().replace(/^((re|fwd?|aw)\s*:\s*)+/i, "").replace(/\s+/g, " ").trim();

const SELECT = "id,conversationId,internetMessageId,subject,from,receivedDateTime,bodyPreview";

export async function sweepMailboxes() {
  if (!mailSweepConfigured()) return { configured: false };
  const db = admin();

  // Throttle + per-mailbox watermarks live in app_settings (id EMBEDDED in
  // data — the client's collection loader needs it there).
  const { data: row } = await db.from("app_settings").select("data").eq("id", "mail_sweep").maybeSingle();
  const state = (row && row.data) || {};
  const now = Date.now();
  if (state.lastRun && now - new Date(state.lastRun).getTime() < 4 * 60 * 1000) return { configured: true, skipped: true };
  const marks = { ...(state.marks || {}) };

  // Which mailboxes: env override, else every non-contractor user's email.
  let mailboxes = [];
  try { mailboxes = JSON.parse(process.env.MAIL_SWEEP_USERS || "[]"); } catch { /* fall through */ }
  if (!mailboxes.length) {
    const { data: users } = await db.from("users").select("email,name,role");
    mailboxes = (users || []).filter((u) => u.email && u.role !== "contractor").map((u) => ({ email: u.email, name: u.name || u.email }));
  } else mailboxes = mailboxes.map((m) => (typeof m === "string" ? { email: m, name: m } : m));
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

  let pinsAdded = 0; const errors = [];
  const adds = {}; // property row id -> [pin, ...]
  for (const mb of mailboxes) {
    try {
      const since = marks[mb.email] || new Date(now - 14 * 86400000).toISOString();
      const filter = encodeURIComponent(`receivedDateTime ge ${since}`);
      const d = await graph(`/users/${encodeURIComponent(mb.email)}/mailFolders/inbox/messages?$filter=${filter}&$select=${SELECT}&$top=50&$orderby=receivedDateTime desc`);
      const items = d.value || [];
      marks[mb.email] = (items[0] && items[0].receivedDateTime) || new Date(now).toISOString();
      const chains = groupChains(items.filter((m) => String(m.receivedDateTime || "") > since));
      chains.forEach((ch) => {
        const m = ch.latest;
        const im = m.internetMessageId || "";
        const fromA = String(m.from?.emailAddress?.address || "").toLowerCase();
        const sk = subjKey(m.subject);
        props.forEach((p) => {
          const skip = p.autoPinSkip || [];
          if (skip.includes(ch.key) || (im && skip.includes(im))) return;
          const pinnedNow = [...(p.pinnedEmails || []), ...((adds[p.rowId] || []))];
          if (pinnedNow.some((pe) => (pe.internetMessageId && pe.internetMessageId === im) || pe.conversationId === ch.key || (sk && subjKey(pe.subject) === sk))) return;
          const senderHit = fromA && byEmail[fromA] != null && String(byEmail[fromA]) === String(p.id);
          if (!senderHit && !chainMatchesProperty(ch, p)) return;
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
  for (const [rowId, pins] of Object.entries(adds)) {
    try {
      const { data: fresh } = await db.from("properties").select("data").eq("id", rowId).maybeSingle();
      if (!fresh || !fresh.data) continue;
      const cur = fresh.data.pinnedEmails || [];
      const skip = fresh.data.autoPinSkip || [];
      const clean = pins.filter((a) => !cur.some((pe) => (pe.internetMessageId && pe.internetMessageId === a.internetMessageId) || pe.conversationId === a.conversationId || (subjKey(a.subject) && subjKey(pe.subject) === subjKey(a.subject))) && !skip.includes(a.conversationId) && !(a.internetMessageId && skip.includes(a.internetMessageId)));
      if (!clean.length) continue;
      await db.from("properties").update({ data: { ...fresh.data, pinnedEmails: [...cur, ...clean] } }).eq("id", rowId);
    } catch (e) { errors.push(`save ${rowId}: ${e.message}`); }
  }

  await db.from("app_settings").upsert({ id: "mail_sweep", data: { id: "mail_sweep", lastRun: new Date(now).toISOString(), marks }, updated_at: new Date(now).toISOString() });
  return { configured: true, mailboxes: mailboxes.length, pinsAdded, errors: errors.slice(0, 4) };
}
