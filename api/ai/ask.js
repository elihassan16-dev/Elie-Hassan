// Property Q&A assistant: the client sends a question plus a JSON snapshot of one
// property (info, financials, tasks, leads, recent messages) and Claude answers
// from that data only — "what's the lockbox code?", "how much was the rehab?".
// Multi-turn: the client replays the recent chat history for follow-up questions.
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

const SYSTEM = `You are the property assistant for Goldstone Properties, a New Jersey real-estate flipping company. Answer questions about ONE property using ONLY the property data provided below. Be direct and brief — lead with the answer (a code, a number, a name), then at most a sentence of context. Format money as dollars. Dates as e.g. "Mar 14, 2026".
If the data doesn't contain the answer, say plainly that it isn't in this property's records — never guess or make figures up. If a field is empty, say it hasn't been filled in yet.`;

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: "AI isn't set up yet — add ANTHROPIC_API_KEY in Vercel." });
    return;
  }
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }

  const { question, history, context } = await readBody(req);
  const q = String(question || "").trim();
  if (!q) { res.status(400).json({ error: "Ask a question first." }); return; }

  // Replay only well-formed recent turns; the property snapshot lives in the system
  // prompt so it isn't resent inside every history message.
  const past = (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1000,
      system: `${SYSTEM}\n\nPROPERTY DATA (JSON):\n${String(context || "{}").slice(0, 60000)}`,
      messages: [...past, { role: "user", content: q.slice(0, 2000) }],
    });
    const answer = (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    if (!answer) { res.status(502).json({ error: "The AI returned an empty answer — try again." }); return; }
    res.status(200).json({ answer });
  } catch (e) {
    const status = e?.status === 429 ? 429 : 502;
    res.status(status).json({ error: status === 429 ? "AI is busy right now — try again in a moment." : `AI answer failed: ${e.message || "unknown error"}` });
  }
}
