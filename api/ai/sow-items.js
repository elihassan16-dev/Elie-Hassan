// AI for the scope BUILDER: Elie talks ("gut both baths, windows as needed,
// not sure about the roof yet") and Claude answers with structured lines —
// category, text, status — reusing his library's wording wherever it fits so
// the scope stays in his voice. Returns JSON only; the app merges it into the
// house's scope. Team-only (contractors never reach this).
import Anthropic from "@anthropic-ai/sdk";
import { requireTeamUser } from "../../lib/quickbooks.js";

export const config = { maxDuration: 120 };

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

const SYSTEM = `You turn a house flipper's spoken notes into Scope-of-Work lines for contractors to price (Goldstone Properties, New Jersey).

You get: the category keys, the flipper's LIBRARY of standard lines (id, cat, text), the lines ALREADY in this house's scope, and the new notes.
Return ONLY a JSON object: {"items":[{"libId":"<library id or null>","cat":"<category key>","text":"<line text>","status":"in|asneeded|discuss"}], "remove":["<scope line id>"]}

Rules:
- Prefer library lines: when a note matches a library line, return that line's libId and its exact text (edit the text only if the note clearly changes it).
- Write new lines in the same plain, contractor-ready voice as the library (imperative, specific, no prices, no markdown).
- status: "in" normally; "asneeded" when the notes say as needed / if needed / where needed / confirm on site; "discuss" when the notes are unsure, say to discuss, TBD, maybe, not sure, or ask a question.
- Only put in "remove" the ids of EXISTING scope lines the notes explicitly cancel ("take out the roof", "no deck").
- Never repeat a line already in the scope unless the notes change its status or wording — then return it with its libId and the new status/text.
- Keep it to what the notes say; do not pad with assumptions.`;

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(503).json({ error: "AI isn't set up yet — add ANTHROPIC_API_KEY in Vercel." }); return; }
  const user = await requireTeamUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }

  const { brief, property, cats, library, current } = await readBody(req);
  const ask = String(brief || "").trim();
  if (!ask) { res.status(400).json({ error: "Say what to add first." }); return; }

  const lib = Array.isArray(library) ? library.slice(0, 400).map((it) => ({ id: String(it.id || ""), cat: String(it.cat || ""), text: String(it.text || "").slice(0, 200) })) : [];
  const cur = Array.isArray(current) ? current.slice(0, 200).map((it) => ({ id: String(it.id || ""), libId: it.libId || null, cat: String(it.cat || ""), text: String(it.text || "").slice(0, 200), status: it.status || "in" })) : [];
  const content = [
    property ? `Property: ${String(property).slice(0, 200)}` : "",
    `Category keys: ${JSON.stringify(Array.isArray(cats) ? cats : [])}`,
    `LIBRARY: ${JSON.stringify(lib)}`,
    `ALREADY IN SCOPE: ${JSON.stringify(cur)}`,
    `NOTES: ${ask.slice(0, 3000)}`,
  ].filter(Boolean).join("\n\n");

  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 3000,
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });
    const text = (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    const m = text.match(/\{[\s\S]*\}/);
    let parsed = null;
    try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
    if (!parsed || !Array.isArray(parsed.items)) { res.status(502).json({ error: "The AI didn't return usable lines — try saying it differently." }); return; }
    const okCat = new Set(Array.isArray(cats) ? cats.map(String) : []);
    const items = parsed.items
      .filter((it) => it && String(it.text || "").trim())
      .map((it) => ({
        libId: it.libId ? String(it.libId) : null,
        cat: okCat.has(String(it.cat)) ? String(it.cat) : "general",
        text: String(it.text).trim().slice(0, 300),
        status: ["in", "asneeded", "discuss"].includes(it.status) ? it.status : "in",
      }))
      .slice(0, 60);
    const remove = Array.isArray(parsed.remove) ? parsed.remove.map(String).slice(0, 60) : [];
    res.status(200).json({ items, remove });
  } catch (e) {
    const status = e?.status === 429 ? 429 : 502;
    res.status(status).json({ error: status === 429 ? "AI is busy right now — try again in a moment." : `AI failed: ${e.message || "unknown error"}` });
  }
}
