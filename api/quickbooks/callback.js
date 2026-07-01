import { exchangeCode, saveConnection, redirectUri, appUrl } from "../../lib/quickbooks.js";

// Intuit redirects here with ?code=...&realmId=...&state=...
export default async function handler(req, res) {
  const { code, realmId, state, error } = req.query;
  const back = appUrl(req);
  try {
    if (error) throw new Error(String(error));
    const cookie = req.headers.cookie || "";
    const savedState = /(?:^|;\s*)qb_state=([^;]+)/.exec(cookie)?.[1];
    if (!state || !savedState || state !== savedState) throw new Error("State mismatch — please try connecting again.");
    if (!code || !realmId) throw new Error("Missing code or company id from QuickBooks.");

    const tok = await exchangeCode(code, redirectUri(req));
    await saveConnection(String(realmId), tok);

    res.setHeader("Set-Cookie", "qb_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    res.writeHead(302, { Location: `${back}/?qb=connected` });
    res.end();
  } catch (e) {
    res.writeHead(302, { Location: `${back}/?qb=error&msg=${encodeURIComponent(e.message || "connect failed")}` });
    res.end();
  }
}
