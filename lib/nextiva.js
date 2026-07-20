// Nextiva business SMS — send texts from the company's Nextiva number through
// Nextiva's Conversation Service API. Every setting comes from environment
// variables (set in Vercel) so nothing is hardcoded or guessed. Until the
// required vars are present the integration reports "not connected" and the app
// keeps using the phone's built-in texting — so production is unaffected until
// we deliberately turn it on.
//
//   NEXTIVA_TOKEN_URL      OAuth token endpoint (from your Nextiva developer portal)
//   NEXTIVA_API_BASE       Base URL for the messaging API (from the portal)
//   NEXTIVA_SEND_PATH      Path appended to the base for sending (default "/messages")
//   NEXTIVA_CLIENT_ID      OAuth client id
//   NEXTIVA_CLIENT_SECRET  OAuth client secret
//   NEXTIVA_USERNAME       (optional) username, if your account uses the password grant
//   NEXTIVA_PASSWORD       (optional) password, if your account uses the password grant
//   NEXTIVA_SCOPE          (optional) OAuth scope
//   NEXTIVA_FROM_NUMBER    your SMS-enabled Nextiva number, E.164 (e.g. +17325551234)
//   NEXTIVA_CAMPAIGN_ID    (optional) your 10DLC campaign id

export function config() {
  const e = process.env;
  const hasCreds = !!(e.NEXTIVA_CLIENT_ID && e.NEXTIVA_CLIENT_SECRET) || !!(e.NEXTIVA_USERNAME && e.NEXTIVA_PASSWORD);
  const configured = !!(e.NEXTIVA_TOKEN_URL && e.NEXTIVA_API_BASE && e.NEXTIVA_FROM_NUMBER && hasCreds);
  return {
    configured,
    tokenUrl: e.NEXTIVA_TOKEN_URL || "",
    apiBase: (e.NEXTIVA_API_BASE || "").replace(/\/$/, ""),
    sendPath: e.NEXTIVA_SEND_PATH || "/messages",
    clientId: e.NEXTIVA_CLIENT_ID || "",
    clientSecret: e.NEXTIVA_CLIENT_SECRET || "",
    username: e.NEXTIVA_USERNAME || "",
    password: e.NEXTIVA_PASSWORD || "",
    scope: e.NEXTIVA_SCOPE || "",
    from: e.NEXTIVA_FROM_NUMBER || "",
    campaignId: e.NEXTIVA_CAMPAIGN_ID || "",
  };
}

// Normalize to E.164 (Nextiva, like every SMS API, wants +1XXXXXXXXXX).
export function e164(n) {
  const d = String(n || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return "+" + d;
}

let cached = null; // { token, exp }

async function getToken(cfg) {
  if (cached && cached.exp > Date.now() + 30000) return cached.token;
  const body = new URLSearchParams();
  if (cfg.username && cfg.password) {
    body.set("grant_type", "password");
    body.set("username", cfg.username);
    body.set("password", cfg.password);
  } else {
    body.set("grant_type", "client_credentials");
  }
  if (cfg.clientId) body.set("client_id", cfg.clientId);
  if (cfg.clientSecret) body.set("client_secret", cfg.clientSecret);
  if (cfg.scope) body.set("scope", cfg.scope);
  const r = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(j.error_description || j.error || `Nextiva sign-in failed (${r.status}).`);
  cached = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return cached.token;
}

// Send one SMS. The request body follows Nextiva's documented Conversation
// Service shape; the exact field names for YOUR account are confirmed during
// the first live test and adjusted here if needed (one place, easy to tweak).
export async function sendSms(to, message) {
  const cfg = config();
  if (!cfg.configured) throw new Error("Nextiva isn't connected yet.");
  const token = await getToken(cfg);
  const payload = {
    from: cfg.from,
    to: e164(to),
    message: String(message || ""),
    type: "TEXT",
    ...(cfg.campaignId ? { campaignId: cfg.campaignId } : {}),
  };
  const r = await fetch(`${cfg.apiBase}${cfg.sendPath}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || j.error_description || j.error || `Nextiva send failed (${r.status}).`);
  return j;
}
