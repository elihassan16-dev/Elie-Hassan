import { PublicClientApplication } from "@azure/msal-browser";

// These are PUBLIC identifiers (a client ID is meant to live in browser code);
// access is gated by the user's Microsoft sign-in + the Graph permissions granted.
const CLIENT_ID = "8b1ca3b1-7c66-4a1e-958a-c44df9e4cdff";
const TENANT_ID = "377dbf92-fa58-4e25-bd42-f96116751c69";

export const GRAPH_SCOPES = ["User.Read", "Files.ReadWrite.All"];
// Requested separately (only when browsing SharePoint sites) so it never blocks
// the core OneDrive login. Needs admin consent for Sites.Read.All in Azure.
export const SITE_SCOPES = ["Sites.Read.All"];
// Requested separately by the Email tab so it never blocks the core login.
// Add Mail.Read + Mail.Send (delegated) to the Azure app registration and grant
// consent, or the first Email sign-in will prompt for these permissions.
export const MAIL_SCOPES = ["Mail.Read", "Mail.Send"];

export const msalInstance = new PublicClientApplication({
  auth: {
    clientId: CLIENT_ID,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    redirectUri: typeof window !== "undefined" ? window.location.origin : "/",
  },
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: false,
  },
});

let initPromise = null;
export function ensureMsalReady() {
  if (!initPromise) initPromise = msalInstance.initialize();
  return initPromise;
}
