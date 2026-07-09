// AI message drafting for the chat composer. The client sends what the user wants
// ("ask Esther for an update, friendly"), plus the conversation context (property,
// task, recent messages) and any current draft to revise — Claude returns just the
// message text, which the composer prefills for review before Send.
// Requires ANTHROPIC_API_KEY in Vercel (console.anthropic.com → API Keys).
import Anthropic from "@anthropic-ai/sdk";
import { requireAppUser } from "../../lib/quickbooks.js";

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return await new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

const SYSTEM = `You draft short internal team messages for Goldstone Properties, a New Jersey real-estate flipping company. Follow the instruction and use the provided context (property, task, recent messages) to make the message specific — name the task or property when it's known instead of saying "this".
Output ONLY the message text, exactly as it should be sent — no preamble, no explanation, no quotation marks around it, no subject line, no signature. Default to a friendly, direct tone using first names, 1–3 sentences, unless the instruction asks for something else.`;

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: "AI drafting isn't set up yet — add ANTHROPIC_API_KEY in Vercel." });
    return;
  }
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }

  const { instruction, context, current, sender } = await readBody(req);
  const ask = String(instruction || "").trim();
  if (!ask) { res.status(400).json({ error: "Tell the AI what to write first." }); return; }

  const parts = [];
  if (sender) parts.push(`The message is being written by (sent from): ${sender}`);
  if (context) parts.push(`Context:\n${String(context).slice(0, 4000)}`);
  if (current) parts.push(`Current draft to revise:\n${String(current).slice(0, 2000)}`);
  parts.push(`Instruction: ${ask.slice(0, 1000)}`);

  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 700,
      system: SYSTEM,
      messages: [{ role: "user", content: parts.join("\n\n") }],
    });
    const draft = (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    if (!draft) { res.status(502).json({ error: "The AI returned an empty draft — try rephrasing." }); return; }
    res.status(200).json({ draft });
  } catch (e) {
    const status = e?.status === 429 ? 429 : 502;
    res.status(status).json({ error: status === 429 ? "AI is busy right now — try again in a moment." : `AI draft failed: ${e.message || "unknown error"}` });
  }
}
