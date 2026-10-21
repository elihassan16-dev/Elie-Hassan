import { PublicClientApplication } from "@azure/msal-browser";

// These are PUBLIC identifiers (a client ID is meant to live in browser code);
// access is gated by the user's Microsoft sign-in + the Graph permissions granted.
const CLIENT_ID = "8b1ca3b1-7c66-4a1e-958a-c44df9e4cdff";
const TENANT_ID = "377dbf92-fa58-4e25-bd42-f96116751c69";

// offline_access → Microsoft issues a refresh token so we can renew access tokens
// silently in the background instead of bouncing the user back to the sign-in page.
export const GRAPH_SCOPES = ["User.Read", "Files.ReadWrite.All", "offline_access"];
// Requested separately (only when browsing SharePoint sites) so it never blocks
// the core OneDrive login. Needs admin consent for Sites.Read.All in Azure.
export const SITE_SCOPES = ["Sites.Read.All"];
// Requested separately by the Email tab so it never blocks the core login.
// Add Mail.ReadWrite + Mail.Send (delegated) to the Azure app registration and
// grant consent, or the first Email sign-in will prompt for these permissions.
// Mail.ReadWrite (superset of Mail.Read) also lets us mark messages read.
// People.Read powers Outlook recipient suggestions (the people you actually
// email, ranked by Microsoft). IT granted tenant-wide admin consent for
// People.Read + People.Read.All on Aug 12 2026 — do NOT add scopes here that
// lack consent, they block the whole email sign-in for everyone.
export const MAIL_SCOPES = ["Mail.ReadWrite", "Mail.Send", "People.Read", "offline_access"];

export const msalInstance = new PublicClientApplication({
  auth: {
    clientId: CLIENT_ID,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    redirectUri: typeof window !== "undefined" ? window.location.origin : "/",
  },
  cache: {
    // Persist the token cache across sessions, and keep auth state in a cookie so
    // Safari/iOS (which is aggressive about clearing storage) stays signed in and
    // completes the redirect reliably — far fewer "please log in again" prompts.
    cacheLocation: "localStorage",
    storeAuthStateInCookie: true,
  },
});

// ── Whose Microsoft account is it? ────────────────────────────────────────────
// MSAL remembers Microsoft logins per BROWSER, not per Goldstone login — so
// Moshe signed in on Elie's computer saw Elie's mailbox (Elie 10/21/26). Each
// Microsoft account on this browser is now tied to the Goldstone user who
// connected it, and only that user gets it. An account whose Microsoft email
// equals the Goldstone login email is claimed automatically.
const OWN_KEY = "gs_ms_owner";   // { homeAccountId: goldstoneUserId }
const CLAIM_KEY = "gs_ms_claim"; // goldstone user id waiting on a Microsoft redirect
let msUser = null;               // { id, email } of the signed-in Goldstone user
const readOwners = () => { try { return JSON.parse(localStorage.getItem(OWN_KEY) || "{}") || {}; } catch { return {}; } };
const writeOwners = (m) => { try { localStorage.setItem(OWN_KEY, JSON.stringify(m)); } catch { /* private mode */ } };
export function setMsalUser(u) {
  const next = u && u.id ? { id: u.id, email: String(u.email || "").toLowerCase() } : null;
  if ((next && next.id) === (msUser && msUser.id)) return;
  msUser = next;
  try { window.dispatchEvent(new Event("gs-msal-user")); } catch { /* no window */ }
}
export function ownedAccount() {
  if (!msUser) return null;
  const all = msalInstance.getAllAccounts();
  const map = readOwners();
  let acc = all.find((a) => map[a.homeAccountId] === msUser.id) || null;
  if (!acc) {
    acc = all.find((a) => !map[a.homeAccountId] && String(a.username || "").toLowerCase() === msUser.email) || null;
    if (acc) { map[acc.homeAccountId] = msUser.id; writeOwners(map); }
  }
  if (acc && msalInstance.getActiveAccount()?.homeAccountId !== acc.homeAccountId) msalInstance.setActiveAccount(acc);
  return acc;
}
// Call right before loginRedirect: the account that comes back belongs to this user.
export function markMsalClaim() { try { if (msUser) sessionStorage.setItem(CLAIM_KEY, msUser.id); } catch { /* ignore */ } }
export function finishMsalClaim(account) {
  let uid = null; try { uid = sessionStorage.getItem(CLAIM_KEY); sessionStorage.removeItem(CLAIM_KEY); } catch { /* ignore */ }
  if (!uid || !account) return;
  const map = readOwners(); map[account.homeAccountId] = uid; writeOwners(map);
}
export function releaseMsalAccount(account) {
  if (!account) return;
  const map = readOwners(); delete map[account.homeAccountId]; writeOwners(map);
}

let initPromise = null;
export function ensureMsalReady() {
  if (!initPromise) initPromise = msalInstance.initialize();
  return initPromise;
}

// ── Session keep-alive ────────────────────────────────────────────────────────
// Microsoft caps browser-app refresh tokens at 24 hours — but every silent
// renewal ROTATES the token with a fresh 24-hour clock. Tokens used to renew
// only when the Email/Files tabs actually called Graph, so a day of using the
// app without touching those tabs ended in "please sign in again". Renewing in
// the background on every app open/resume keeps one sign-in alive indefinitely
// for anyone who opens the app most days.
let lastKeepAlive = 0;
export async function keepMsalFresh() {
  const now = Date.now();
  if (now - lastKeepAlive < 30 * 60 * 1000) return; // throttle: at most every 30 min
  lastKeepAlive = now;
  try {
    await ensureMsalReady();
    const acc = ownedAccount();
    if (!acc) return;
    // forceRefresh hits the token endpoint (rotating the refresh token) instead of
    // serving a still-valid access token from cache. Failures are fine here — the
    // on-demand path still recovers interactively when the user next needs Graph.
    await msalInstance.acquireTokenSilent({ scopes: GRAPH_SCOPES, account: acc, forceRefresh: true }).catch(() => null);
    await msalInstance.acquireTokenSilent({ scopes: MAIL_SCOPES, account: acc, forceRefresh: true }).catch(() => null);
  } catch { /* best-effort */ }
}
export function startMsalKeepAlive() {
  keepMsalFresh();
  const onShow = () => { if (typeof document === "undefined" || document.visibilityState === "visible") keepMsalFresh(); };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onShow);
  if (typeof window !== "undefined") window.addEventListener("focus", onShow);
}
