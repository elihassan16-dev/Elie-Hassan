// 🤖 Goldstone connector for Claude (MCP over Streamable HTTP, stateless JSON).
// Claude → Settings → Connectors → Add custom connector → https://gpflips.com/api/mcp
// Auth: OAuth (api/oauth/* + lib/mcpAuth.js) — every call runs as the teammate
// who connected (their name on tasks/messages, their own texting line); the
// identity comes from the token, never from anything Claude sends.
// Contractors can't connect.
import { userFromBearer, baseUrl } from "../lib/mcpAuth.js";
import { TOOLS, runTool, UserError } from "../lib/mcpTools.js";

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS = `Goldstone Properties is a real-estate flip and rental company (team: Elie, Moshe, Esti). These tools act inside the team's app as the signed-in teammate.
- Properties are named by address; pass part of the address (e.g. "19 Orchard"). "company" means Company tasks.
- Tasks have an owner (assignee) and optionally a delegate who does the work; they can be urgent and can have checklist items.
- Before send_text, ALWAYS show the exact recipient and message and wait for an explicit yes; then call with confirmed=true.
- When a lookup is ambiguous, the tool says so — ask the user which one.`;

const rpc = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcErr = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(msg, me) {
  const { id, method, params } = msg || {};
  const isNote = id === undefined || id === null;
  switch (method) {
    case "initialize": {
      const want = params && params.protocolVersion;
      return rpc(id, {
        protocolVersion: VERSIONS.includes(want) ? want : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "goldstone", title: "Goldstone Properties", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping": return rpc(id, {});
    case "tools/list": return rpc(id, { tools: TOOLS });
    case "tools/call": {
      const name = params && params.name;
      if (!TOOLS.some((t) => t.name === name)) return rpcErr(id, -32602, `Unknown tool: ${name}`);
      try {
        const text = await runTool(name, (params && params.arguments) || {}, me);
        return rpc(id, { content: [{ type: "text", text: String(text || "Done.") }] });
      } catch (e) {
        const text = e instanceof UserError ? e.message : `Something went wrong: ${e.message}`;
        return rpc(id, { content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      if (isNote || String(method || "").startsWith("notifications/")) return null;
      return rpcErr(id, -32601, `Method not found: ${method}`);
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version");
  res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id");
  if (req.method === "OPTIONS") return res.status(204).end();
  const me = await userFromBearer(req).catch(() => null);
  if (!me) {
    res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource"`);
    return res.status(401).json({ error: "unauthorized", error_description: "Connect with your Goldstone login." });
  }
  if (req.method === "GET") { res.setHeader("Allow", "POST"); return res.status(405).end(); } // no server-initiated stream
  if (req.method === "DELETE") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { return res.status(400).json(rpcErr(null, -32700, "Parse error")); } }
  const batch = Array.isArray(body);
  const out = [];
  for (const m of batch ? body : [body]) { const r = await handle(m, me); if (r) out.push(r); }
  if (!out.length) return res.status(202).end();
  res.setHeader("Content-Type", "application/json");
  return res.status(200).send(JSON.stringify(batch ? out : out[0]));
}
