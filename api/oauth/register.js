// Dynamic client registration (RFC 7591) — Claude registers itself here once.
import { registerClient } from "../../lib/mcpAuth.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const rec = await registerClient(req.body || {});
    return res.status(201).json({
      client_id: rec.client_id, client_name: rec.client_name, redirect_uris: rec.redirect_uris,
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none",
      client_id_issued_at: Math.floor(rec.created / 1000),
    });
  } catch (e) {
    return res.status(400).json({ error: "invalid_client_metadata", error_description: e.message });
  }
}
