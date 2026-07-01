import { PublicClientApplication } from "@azure/msal-browser";

// These are PUBLIC identifiers (a client ID is meant to live in browser code);
// access is gated by the user's Microsoft sign-in + the Graph permissions granted.
const CLIENT_ID = "8b1ca3b1-7c66-4a1e-958a-c44df9e4cdff";
const TENANT_ID = "377dbf92-fa58-4e25-bd42-f96116751c69";

export const GRAPH_SCOPES = ["User.Read", "Files.ReadWrite.All"];

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
