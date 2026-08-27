// Walkthrough → punch list: the client records (or uploads) a narrated video,
// transcribes it with timestamps, and posts the segments here; Claude turns
// them into itemized, room-grouped punch-list items — each keeping the time
// range where it was said, so the client can grab the matching video frame
// and the PDF can cite "video 0:38–0:52".
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

const SYSTEM = `You turn a narrated property-walkthrough transcript into a contractor punch list for Goldstone Properties, a New Jersey house-flipping company. The transcript arrives as timed segments: [start–end seconds] spoken text.

Rules:
- COMPLETENESS FIRST: never drop a piece of work he mentions — even briefly, in passing, or at the very end of the video ("also, clean up these chairs" IS an item). If unsure whether two mentions are the same job, keep them as SEPARATE items. Missing an item is the worst failure.
- One item per distinct defect or piece of work. Merge fragments only when they clearly describe the SAME thing (he may talk about one problem across several segments).
- List items in the order they were spoken.
- title: the WORK to do, short and contractor-ready ("Regrout tub surround", "Replace exhaust fan"). Not a description of the problem — the fix.
- detail: one sentence a contractor can act on, including location specifics he gave ("left of the stove", "back wall of the tub").
- room: the room or area ("Master bath", "Kitchen", "Basement", "Exterior", "Garage"...). Infer from narration; carry the current room forward until he clearly moves. Unknown → "General".
- quote: his actual words for this item, trimmed (max ~90 chars).
- start/end: seconds, copied STRICTLY from the bracketed second-values of the segment(s) where THIS item is discussed — start = the segment where he first mentions it, end = where he finishes with it (end > start; one segment → its bounds). Never reuse another item's times, never estimate times that aren't in the brackets.
- Skip filler, greetings, and hesitations — but "skip" applies only to non-work chatter, never to a real task. Never invent work he didn't mention.

Return STRICT JSON only — an array: [{"title":"","detail":"","room":"","quote":"","start":0,"end":0}] — no markdown, no commentary.`;

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(503).json({ error: "AI isn't set up yet — add ANTHROPIC_API_KEY in Vercel." }); return; }
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }

  const { segments, address } = await readBody(req);
  const segs = (Array.isArray(segments) ? segments : [])
    .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: String(s.text || "").trim() }))
    .filter((s) => s.text)
    .slice(0, 600);
  if (!segs.length) { res.status(400).json({ error: "No transcript to work from." }); return; }

  const fmtT = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  const transcript = segs.map((s) => `[${fmtT(s.start)}-${fmtT(s.end)} | ${Math.round(s.start)}-${Math.round(s.end)}s] ${s.text}`).join("\n");

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: "user", content: `Property: ${String(address || "").slice(0, 120)}\n\nTranscript:\n${transcript.slice(0, 60000)}` }],
    });
    const raw = (msg.content || []).map((c) => c.text || "").join("");
    const jsonText = (raw.match(/\[[\s\S]*\]/) || [raw])[0];
    let items;
    try { items = JSON.parse(jsonText); } catch { res.status(502).json({ error: "The AI response couldn't be read — try again." }); return; }
    if (!Array.isArray(items)) items = [];
    items = items
      .map((it) => ({
        title: String(it.title || "").slice(0, 160),
        detail: String(it.detail || "").slice(0, 400),
        room: String(it.room || "General").slice(0, 40),
        quote: String(it.quote || "").slice(0, 120),
        start: Math.max(0, Number(it.start) || 0),
        end: Math.max(0, Number(it.end) || 0),
      }))
      .filter((it) => it.title);
    res.status(200).json({ items });
  } catch (e) {
    console.error("[ai] walkthrough failed:", e.message);
    res.status(502).json({ error: e.message });
  }
}
