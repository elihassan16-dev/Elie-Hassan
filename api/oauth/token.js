// Token endpoint: authorization_code (+PKCE) → tokens, and refresh_token rotation.
import { getClient, redeemCode, issueTokens, refreshTokens, activeTeamUser } from "../../lib/mcpAuth.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "invalid_request" });
  const b = req.body || {};
  try {
    if (b.grant_type === "authorization_code") {
      const client = await getClient(b.client_id);
      if (!client) return res.status(401).json({ error: "invalid_client" });
      const uid = await redeemCode({ code: b.code, clientId: b.client_id, redirectUri: b.redirect_uri, verifier: b.code_verifier });
      if (!(await activeTeamUser(uid))) return res.status(400).json({ error: "invalid_grant" });
      return res.status(200).json(await issueTokens(uid, b.client_id));
    }
    if (b.grant_type === "refresh_token") {
      return res.status(200).json(await refreshTokens(b.refresh_token, b.client_id));
    }
    return res.status(400).json({ error: "unsupported_grant_type" });
  } catch (e) {
    return res.status(400).json({ error: e.message === "invalid_grant" ? "invalid_grant" : "invalid_request", error_description: e.message });
  }
}
