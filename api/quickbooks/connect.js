import { AUTHORIZE_URL, SCOPE, config, redirectUri } from "../../lib/quickbooks.js";

// Starts the QuickBooks OAuth flow — full-page redirect to Intuit's consent screen.
export default function handler(req, res) {
  const cfg = config();
  if (!cfg.hasSecret || !cfg.hasServiceRole) {
    res.status(500).send(
      "QuickBooks isn't configured yet. Set QB_CLIENT_SECRET and SUPABASE_SERVICE_ROLE_KEY in Vercel."
    );
    return;
  }
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  // Short-lived state cookie to protect against CSRF on the callback.
  res.setHeader("Set-Cookie", `qb_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  const params = new URLSearchParams({
    client_id: cfg.CLIENT_ID,
    response_type: "code",
    scope: SCOPE,
    redirect_uri: redirectUri(req),
    state,
  });
  res.writeHead(302, { Location: `${AUTHORIZE_URL}?${params.toString()}` });
  res.end();
}
