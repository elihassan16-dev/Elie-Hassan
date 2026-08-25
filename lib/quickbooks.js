// Server-side QuickBooks Online helpers (run only inside Vercel serverless
// functions — never imported by the browser bundle). The client SECRET and the
// Supabase service-role key live here via env vars and never reach the client.
import { createClient } from "@supabase/supabase-js";

const CLIENT_ID = process.env.QB_CLIENT_ID;
const CLIENT_SECRET = process.env.QB_CLIENT_SECRET;
const QB_ENV = (process.env.QB_ENV || "production").toLowerCase();

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
export const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const API_BASE =
  QB_ENV === "sandbox" ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com";
export const SCOPE = "com.intuit.quickbooks.accounting";

export function config() {
  return { CLIENT_ID, hasSecret: !!CLIENT_SECRET, QB_ENV, hasServiceRole: !!SERVICE_ROLE };
}

export function redirectUri(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}/api/quickbooks/callback`;
}
export function appUrl(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}`;
}

export function admin() {
  if (!SERVICE_ROLE) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY env var.");
  return createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
}

function basicAuth() {
  return "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
}

// Intuit stamps every response with an `intuit_tid` transaction id. Capturing it
// is critical for troubleshooting: it's the trace id Intuit support uses to look
// up a specific failed request.
function tid(r) {
  return r.headers.get("intuit_tid") || r.headers.get("intuit-tid") || "n/a";
}

// Log to the serverless function logs (Vercel captures console output) and return
// the same message to throw, so every failure is both logged and surfaced.
function qbError(context, r, bodyText) {
  const msg = `${context} (status ${r.status}, intuit_tid ${tid(r)}): ${bodyText}`;
  console.error("[quickbooks]", msg);
  return new Error(msg);
}

export async function exchangeCode(code, redirect) {
  if (!CLIENT_SECRET) throw new Error("Missing QB_CLIENT_SECRET env var.");
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  if (!r.ok) throw qbError("Token exchange failed", r, await r.text());
  return r.json();
}

async function refresh(refreshToken) {
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  if (!r.ok) throw qbError("Token refresh failed", r, await r.text());
  return r.json();
}

export async function saveConnection(realmId, tok) {
  const db = admin();
  const expiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString();
  await db.from("quickbooks_connection").upsert({
    id: "default",
    realm_id: realmId,
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });
}

export async function getConnection() {
  const db = admin();
  const { data } = await db.from("quickbooks_connection").select("*").eq("id", "default").maybeSingle();
  return data || null;
}

export async function disconnect() {
  const db = admin();
  await db.from("quickbooks_connection").delete().eq("id", "default");
}

// Returns a valid access token + realmId, refreshing (and persisting) if expired.
export async function getValidToken() {
  const conn = await getConnection();
  if (!conn) throw new Error("QuickBooks is not connected.");
  if (new Date(conn.expires_at).getTime() > Date.now()) {
    return { accessToken: conn.access_token, realmId: conn.realm_id };
  }
  const tok = await refresh(conn.refresh_token);
  const db = admin();
  const expiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString();
  await db.from("quickbooks_connection").update({
    access_token: tok.access_token,
    refresh_token: tok.refresh_token || conn.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }).eq("id", "default");
  return { accessToken: tok.access_token, realmId: conn.realm_id };
}

export async function qbApi(path) {
  const { accessToken, realmId } = await getValidToken();
  const sep = path.includes("?") ? "&" : "?";
  const url = `${API_BASE}/v3/company/${realmId}${path}${sep}minorversion=70`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  if (!r.ok) throw qbError(`QuickBooks API ${path} failed`, r, await r.text());
  return r.json();
}

// ── Durable shared cache (app_settings row "qb_cache") ───────────────────────
// Intuit caps unpublished apps at 500K calls per MONTH — the balance poll,
// per-project P&L scans and the transaction-search fan-out burned through it.
// Serverless instances are throwaway, so warm-memory caches re-spend calls on
// every cold start; this row is the durable copy every instance shares. On any
// QuickBooks failure (throttle included) callers serve the stale copy instead
// of erroring, so the app keeps showing last-known numbers.
// One row PER cache key ("qb_cache_<key>") — reading a small row per request
// instead of one big shared map keeps Supabase egress tiny (the attribution
// map alone can be ~1MB; re-reading it for every accounts poll would burn the
// bandwidth quota we're also trying to protect).
let _qbMem = {}; // key -> {at, hit} warm-instance mirror
async function qbCacheGet(key) {
  const m = _qbMem[key];
  if (m && Date.now() - m.at < 15000) return m.hit;
  try {
    const { data } = await admin().from("app_settings").select("data").eq("id", `qb_cache_${key}`).maybeSingle();
    const hit = (data && data.data && data.data.hit) || null;
    _qbMem[key] = { at: Date.now(), hit };
    return hit;
  } catch { return (m && m.hit) || null; }
}
export async function qbCacheSet(key, data) {
  const hit = { at: Date.now(), data };
  _qbMem[key] = { at: Date.now(), hit };
  try {
    await admin().from("app_settings").upsert({ id: `qb_cache_${key}`, data: { id: `qb_cache_${key}`, hit } });
  } catch { /* cache is best-effort */ }
}
export const isThrottle = (e) => /ThrottleExceeded|status 429|003001/.test(String((e && e.message) || ""));
export const THROTTLE_MSG = "QuickBooks has hit Intuit's monthly API-call limit, so live numbers are paused. It resets on the 1st of the month — reconnecting won't help. Where the app has recent numbers it keeps showing them.";

// Wrap a QuickBooks fetch in the shared cache: serve a fresh-enough copy
// without spending an API call; refresh and store when it's aged out; and on
// ANY failure fall back to the stale copy (flagged) rather than erroring.
export async function qbCached(key, maxAgeMs, fetcher) {
  const hit = await qbCacheGet(key);
  if (hit && Date.now() - hit.at <= maxAgeMs) return { data: hit.data, cachedAt: hit.at };
  try {
    const data = await fetcher();
    await qbCacheSet(key, data);
    return { data, cachedAt: Date.now() };
  } catch (e) {
    if (hit) return { data: hit.data, cachedAt: hit.at, stale: true, throttled: isThrottle(e) };
    if (isThrottle(e)) throw new Error(THROTTLE_MSG);
    throw e;
  }
}

// Verify the caller is a signed-in Goldstone user (Supabase JWT in Authorization header).
export async function requireAppUser(req) {
  const authz = req.headers.authorization || "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7) : null;
  if (!token) return null;
  const anon = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0bXN1a2pudXFzcHJ0dmZ5dGluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4NTE4OTUsImV4cCI6MjA5ODQyNzg5NX0.Ul2Vly-p_KzMuiNCkRIhyv0JYP8vLPTtPKp3mXAEjOk";
  const client = createClient(SUPABASE_URL, anon, { auth: { persistSession: false } });
  const { data } = await client.auth.getUser(token);
  return data?.user || null;
}
