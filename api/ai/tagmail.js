// Bulk email labeler for pinned property chains: subject + preview + sender
// in, {cat, desc} out per item — so the Emails tab can say WHAT a chain is
// about ("septic site evaluation invoice & contract") instead of a keyword
// guess. Called in small batches by the client; each pin is tagged once and
// the result stored on the pin.
import Anthropic from "@anthropic-ai/sdk";
import { requireAppUser } from "../../lib/quickbooks.js";

const CATS = ["Title", "Lender", "Insurance", "Quote", "Permits", "Utilities", "Septic", "Legal", "Other"];

const SYSTEM = `You label emails for a New Jersey real-estate flipping company. For EACH item, pick the one best category and write a tiny plain-English description of what the email chain is about.
Categories (use these exact words): Title (title company / escrow / closing / deed / payoff), Lender (loans, mortgages, appraisals, draws), Insurance, Quote (contractor bids, estimates, scopes, invoices for construction work), Permits (township, zoning, inspections, certificate of occupancy), Utilities, Septic (septic systems, site evaluations, perc/soil testing, septic engineering or design), Legal (attorneys, contracts of sale, addenda), Other.
E-sign notifications (Adobe Acrobat Sign, DocuSign…) are about the DOCUMENT being signed — categorize by that document, and name the real party, never the e-sign service.
desc: at most 8 words, plain and specific — e.g. "septic site evaluation invoice & contract", "W9 from ICD", "insurance binder for closing". No fluff, no guessing beyond what the text supports.
Reply with ONLY a JSON array, no prose: [{"id":"...","cat":"...","desc":"..."}] — one entry per input item, same ids.`;

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

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(503).json({ error: "AI isn't set up yet — add ANTHROPIC_API_KEY in Vercel." }); return; }
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }

  const { items } = await readBody(req);
  const list = (Array.isArray(items) ? items : []).slice(0, 30)
    .filter((x) => x && x.id)
    .map((x) => ({
      id: String(x.id).slice(0, 60),
      from: String(x.from || "").slice(0, 80),
      subject: String(x.subject || "").slice(0, 200),
      preview: String(x.preview || "").slice(0, 300),
    }));
  if (!list.length) { res.status(400).json({ error: "No items." }); return; }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001", // cheap fast classifier — hundreds of pins cost pennies
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(list) }],
    });
    const text = (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    let parsed = [];
    try { parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "")); } catch { /* fall through to keyword tags client-side */ }
    const tags = (Array.isArray(parsed) ? parsed : [])
      .filter((t) => t && t.id)
      .map((t) => ({
        id: String(t.id).slice(0, 60),
        cat: CATS.includes(t.cat) ? t.cat : "Other",
        desc: String(t.desc || "").slice(0, 80),
      }));
    res.status(200).json({ tags });
  } catch (e) {
    res.status(502).json({ error: e.message || "Tagging failed." });
  }
}
