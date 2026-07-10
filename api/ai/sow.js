// AI scope-of-work writer for bid requests: the admin describes the job in a
// sentence or two and Claude drafts a full, trade-by-trade renovation SOW the
// contractor can price. Returns plain text (no pricing — that's the bid).
// Requires ANTHROPIC_API_KEY in Vercel.
import Anthropic from "@anthropic-ai/sdk";
import { requireAppUser } from "../../lib/quickbooks.js";

export const config = { maxDuration: 60 };

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

const SYSTEM = `You write professional residential renovation Scopes of Work for Goldstone Properties, a New Jersey house-flipping company, to send to general contractors for bidding.

Rules:
- Plain text only (no markdown symbols like # or **). Use UPPERCASE section headings organized by trade/area (DEMOLITION, FRAMING, PLUMBING, ELECTRICAL, HVAC, DRYWALL & PAINT, FLOORING, KITCHEN, BATHROOMS, EXTERIOR, SITE & CLEANUP — only the ones that apply), each followed by numbered line items.
- Line items are specific and actionable (materials grade, quantities where inferable, code compliance, permits/inspections responsibility) so a contractor can price them.
- NO pricing, no dollar amounts — the contractor bids on this.
- Base it on the brief given; where the brief is thin, include standard flip-quality assumptions and mark them "(assumed — confirm)".
- End with a short GENERAL CONDITIONS section (licensed & insured, debris removal, workmanship warranty, change-order process).
Output ONLY the scope text.`;

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(503).json({ error: "AI isn't set up yet — add ANTHROPIC_API_KEY in Vercel." }); return; }
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }

  const { brief, property, current } = await readBody(req);
  const ask = String(brief || "").trim();
  if (!ask) { res.status(400).json({ error: "Describe the job first." }); return; }

  const parts = [];
  if (property) parts.push(`Property: ${String(property).slice(0, 200)}`);
  if (current) parts.push(`Existing draft to improve/extend:\n${String(current).slice(0, 6000)}`);
  parts.push(`Job brief: ${ask.slice(0, 2000)}`);

  try {
    const client = new Anthropic();
    const stream = client.messages.stream({
      model: "claude-opus-4-8",
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: "user", content: parts.join("\n\n") }],
    });
    const msg = await stream.finalMessage();
    const sow = (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    if (!sow) { res.status(502).json({ error: "The AI returned nothing — try rephrasing." }); return; }
    res.status(200).json({ sow });
  } catch (e) {
    const status = e?.status === 429 ? 429 : 502;
    res.status(status).json({ error: status === 429 ? "AI is busy right now — try again in a moment." : `AI failed: ${e.message || "unknown error"}` });
  }
}
