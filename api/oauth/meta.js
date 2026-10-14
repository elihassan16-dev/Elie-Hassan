// OAuth discovery for the Claude connector (served at /.well-known/* via vercel.json).
//   ?k=as → authorization-server metadata (RFC 8414)
//   ?k=pr → protected-resource metadata (RFC 9728) for /api/mcp
import { baseUrl } from "../../lib/mcpAuth.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=300");
  const base = baseUrl(req);
  if (req.query.k === "pr") {
    return res.status(200).json({
      resource: `${base}/api/mcp`,
      authorization_servers: [base],
      bearer_methods_supported: ["header"],
      resource_name: "Goldstone Properties",
    });
  }
  return res.status(200).json({
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["goldstone"],
  });
}
