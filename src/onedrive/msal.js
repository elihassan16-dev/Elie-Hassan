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
// NOTE: People.Read (for Outlook recipient suggestions) is intentionally NOT here
// — in this tenant it requires admin approval and would block the whole email
// sign-in. Recipient autocomplete falls back to app contacts; the Outlook-people
// lookup just no-ops if that permission was never granted.
export const MAIL_SCOPES = ["Mail.ReadWrite", "Mail.Send", "offline_access"];

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
    const acc = msalInstance.getActiveAccount() || msalInstance.getAllAccounts()[0];
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
