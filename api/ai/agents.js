// 🎯 Reverse prospecting import (Elie 10/27/26): screenshots of an MLS reverse-
// prospecting report (any MLS — every board lays it out differently), or a
// pasted list / CSV text → the agents on it. Claude reads the pictures and
// returns one row per agent; the app shows them for review before saving.
// Requires ANTHROPIC_API_KEY in Vercel.
import Anthropic from "@anthropic-ai/sdk";
import { requireAppUser } from "../../lib/quickbooks.js";
import { profileOf } from "../../lib/jivetel.js";

export const config = { maxDuration: 120, api: { bodyParser: { sizeLimit: "4mb" } } };

const SYSTEM = `You read real-estate MLS "reverse prospecting" reports (screenshots or pasted text) and list the BUYER'S AGENTS on them — the agents whose clients' saved searches match a listing.
Return ONLY JSON, no prose: {"agents":[{"name":"","phone":"","email":"","office":"","buyers":0,"note":""}]}
- One entry per agent. If an agent appears on several rows (several clients/searches), merge them into one entry and set "buyers" to how many rows/clients they had.
- name: the agent's full name as written (never a client/buyer name, never the office name).
- phone: the agent's best phone (cell/mobile/direct over office), digits and dashes as shown. Empty string if none.
- email, office (brokerage): as shown, or "".
- buyers: number of matching clients/searches for that agent (1 if the report doesn't say).
- note: anything short that helps a pitch (e.g. the search's price range or towns, "emailed 10/20", "viewed listing") — or "".
- Skip header rows, totals, the listing agent, and anything that isn't a person.
- If nothing readable is there, return {"agents":[]}.`;

const parseJson = (s) => {
  const t = String(s || "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
};
const clean = (v, n = 120) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(503).json({ error: "AI reading isn't set up yet — add ANTHROPIC_API_KEY in Vercel." }); return; }
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  const prof = await profileOf(user.id).catch(() => null);
  if (prof?.role === "contractor") { res.status(403).json({ error: "Not available on contractor accounts." }); return; }

  const body = typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const images = (Array.isArray(body.images) ? body.images : []).slice(0, 6)
    .map((x) => { const m = /^data:(image\/(png|jpe?g|webp|gif));base64,(.+)$/i.exec(String(x || "")); return m ? { media_type: m[1].toLowerCase().replace("jpg", "jpeg"), data: m[3] } : null; })
    .filter(Boolean);
  const text = String(body.text || "").slice(0, 60000);
  if (!images.length && !text.trim()) { res.status(400).json({ error: "Add a screenshot or paste the list first." }); return; }

  const content = [
    ...images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } })),
    { type: "text", text: text.trim() ? `Here is the list:\n\n${text}` : `List the buyer's agents in ${images.length > 1 ? "these screenshots" : "this screenshot"}.` },
  ];
  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });
    if (msg.stop_reason === "refusal") { res.status(422).json({ error: "The AI couldn't read that — try a clearer screenshot." }); return; }
    const out = parseJson((msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join(""));
    const agents = (out && Array.isArray(out.agents) ? out.agents : []).map((a) => ({
      name: clean(a.name, 80), phone: clean(a.phone, 40), email: clean(a.email, 120).toLowerCase(), office: clean(a.office, 80),
      buyers: Math.max(1, Math.min(99, parseInt(a.buyers, 10) || 1)), note: clean(a.note, 160),
    })).filter((a) => a.name || a.phone || a.email);
    res.status(200).json({ agents });
  } catch (e) {
    const status = e?.status === 429 ? 429 : 502;
    res.status(status).json({ error: status === 429 ? "AI is busy right now — try again in a moment." : `Couldn't read it: ${e.message || "unknown error"}` });
  }
}
