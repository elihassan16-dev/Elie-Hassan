// 🤖 Claude connector (MCP) — OAuth plumbing (Elie 10/13/26).
// Claude's custom-connector flow: it discovers our OAuth server, registers
// itself (dynamic client registration), sends the person to /api/oauth/authorize
// where they sign in with their normal Goldstone login, then trades the code
// (PKCE S256) for tokens. Every MCP call carries the access token → we know
// exactly which teammate is acting. Contractors are refused.
// Storage: app_settings rows with the "mcp_" prefix (kept out of the app's
// client sync). Codes and tokens are stored ONLY as SHA-256 hashes.
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wtmsukjnuqsprtvfytin.supabase.co";
// Same PUBLIC anon key + guard the app uses (src/supabaseClient.js): an env var
// with stray characters must not break sign-in — fall back to the known-good key.
const FALLBACK_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0bXN1a2pudXFzcHJ0dmZ5dGluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4NTE4OTUsImV4cCI6MjA5ODQyNzg5NX0.Ul2Vly-p_KzMuiNCkRIhyv0JYP8vLPTtPKp3mXAEjOk";
const okKey = (v) => typeof v === "string" && /^[\x21-\x7E]+$/.test(v.trim()) && v.trim().split(".").length === 3;
const ANON = [process.env.SUPABASE_ANON_KEY, process.env.VITE_SUPABASE_ANON_KEY].find(okKey)?.trim() || FALLBACK_ANON_KEY;

export function admin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY env var.");
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
}
export function anonClient() {
  return createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
}

export const baseUrl = (req) => {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "gpflips.com";
  const proto = req.headers["x-forwarded-proto"] || (String(host).startsWith("localhost") ? "http" : "https");
  return `${String(proto).split(",")[0]}://${String(host).split(",")[0]}`;
};
export const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
export const randomToken = (n = 32) => crypto.randomBytes(n).toString("base64url");
const b64url = (buf) => Buffer.from(buf).toString("base64url");

const ACCESS_TTL = 30 * 24 * 3600 * 1000;   // 30 days
const REFRESH_TTL = 365 * 24 * 3600 * 1000; // 1 year
const CODE_TTL = 10 * 60 * 1000;            // 10 minutes

async function putRow(db, id, data) {
  const { error } = await db.from("app_settings").upsert({ id, data }, { onConflict: "id" });
  if (error) throw new Error(error.message);
}
async function getRow(db, id) {
  const { data } = await db.from("app_settings").select("data").eq("id", id).maybeSingle();
  return data && data.data ? data.data : null;
}
async function delRow(db, id) { await db.from("app_settings").delete().eq("id", id); }

// ── Dynamic client registration ──────────────────────────────────────────────
export async function registerClient(meta) {
  const db = admin();
  const id = `gs_${randomToken(12)}`;
  const uris = Array.isArray(meta.redirect_uris) ? meta.redirect_uris.filter((u) => /^https:\/\//i.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)/i.test(u)) : [];
  if (!uris.length) throw new Error("redirect_uris required");
  const rec = { client_id: id, client_name: String(meta.client_name || "Claude").slice(0, 80), redirect_uris: uris, created: Date.now() };
  await putRow(db, `mcp_client_${id}`, rec);
  return rec;
}
export async function getClient(id) {
  if (!id || !/^gs_[A-Za-z0-9_-]+$/.test(id)) return null;
  return getRow(admin(), `mcp_client_${id}`);
}

// ── Codes ────────────────────────────────────────────────────────────────────
export async function issueCode({ uid, clientId, redirectUri, challenge, method }) {
  const code = randomToken(24);
  await putRow(admin(), `mcp_code_${sha(code)}`, { uid, clientId, redirectUri, challenge, method: method || "S256", exp: Date.now() + CODE_TTL });
  return code;
}
export async function redeemCode({ code, clientId, redirectUri, verifier }) {
  const db = admin();
  const id = `mcp_code_${sha(code)}`;
  const rec = await getRow(db, id);
  await delRow(db, id); // single use
  if (!rec || rec.exp < Date.now()) throw new Error("invalid_grant");
  if (rec.clientId !== clientId || rec.redirectUri !== redirectUri) throw new Error("invalid_grant");
  if (!verifier) throw new Error("invalid_grant");
  const calc = b64url(crypto.createHash("sha256").update(verifier).digest());
  if (calc !== rec.challenge) throw new Error("invalid_grant");
  return rec.uid;
}

// ── Tokens ───────────────────────────────────────────────────────────────────
export async function issueTokens(uid, clientId) {
  const db = admin();
  const access = randomToken(32), refresh = randomToken(32);
  await putRow(db, `mcp_tok_${sha(access)}`, { uid, clientId, kind: "access", exp: Date.now() + ACCESS_TTL });
  await putRow(db, `mcp_tok_${sha(refresh)}`, { uid, clientId, kind: "refresh", exp: Date.now() + REFRESH_TTL });
  return { access_token: access, token_type: "Bearer", expires_in: Math.floor(ACCESS_TTL / 1000), refresh_token: refresh };
}
export async function refreshTokens(refresh, clientId) {
  const db = admin();
  const id = `mcp_tok_${sha(refresh)}`;
  const rec = await getRow(db, id);
  if (!rec || rec.kind !== "refresh" || rec.exp < Date.now() || (clientId && rec.clientId !== clientId)) throw new Error("invalid_grant");
  await delRow(db, id); // rotate
  if (!(await activeTeamUser(rec.uid))) throw new Error("invalid_grant");
  return issueTokens(rec.uid, rec.clientId);
}
// Bearer → the teammate (null if missing/expired/contractor).
export async function userFromBearer(req) {
  const authz = req.headers.authorization || "";
  const tok = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  if (!tok) return null;
  const rec = await getRow(admin(), `mcp_tok_${sha(tok)}`);
  if (!rec || rec.kind !== "access" || rec.exp < Date.now()) return null;
  return activeTeamUser(rec.uid);
}
// The public.users profile — team members only.
export async function activeTeamUser(uid) {
  const { data } = await admin().from("users").select("id,name,email,role").eq("id", uid).maybeSingle();
  if (!data || data.role === "contractor") return null;
  return { id: data.id, name: data.name || (data.email || "").split("@")[0], email: data.email, role: data.role || "member" };
}
// Email + password → {uid} or {error} (the same login as the app). The error
// says WHY, so the sign-in page never hides a setup problem behind "wrong password".
export async function passwordLogin(email, password) {
  try {
    const { data, error } = await anonClient().auth.signInWithPassword({ email: String(email || "").trim().toLowerCase(), password: String(password || "") });
    if (data?.user) return { uid: data.user.id };
    const msg = String(error?.message || "");
    console.error("[mcp sign-in] failed:", msg);
    if (/invalid login credentials/i.test(msg)) return { error: "That email or password didn't work. Type the password by hand (the browser may have filled in an old one)." };
    if (/email not confirmed/i.test(msg)) return { error: "This email hasn't been confirmed yet." };
    return { error: `Sign-in problem on our side: ${msg || "unknown error"}. Send Claude a screenshot of this.` };
  } catch (e) {
    console.error("[mcp sign-in] crashed:", e.message);
    return { error: `Sign-in problem on our side: ${e.message}. Send Claude a screenshot of this.` };
  }
}
