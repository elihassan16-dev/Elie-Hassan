// Record-to-transcribe: the client records audio (MediaRecorder — reliable on
// iOS, unlike in-page speech recognition which can freeze PWAs) and posts it
// here; Cloudflare Workers AI (Whisper) turns it into text.
// Requires CF_ACCOUNT_ID + CF_AI_TOKEN (a Cloudflare token with Workers AI read).
import { requireAppUser } from "../../lib/quickbooks.js";

export const config = { maxDuration: 60, api: { bodyParser: { sizeLimit: "10mb" } } };

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_AI_TOKEN = process.env.CF_AI_TOKEN || process.env.CF_STREAM_TOKEN;

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
  const user = await requireAppUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  if (!CF_ACCOUNT_ID || !CF_AI_TOKEN) { res.status(503).json({ error: "Transcription isn't set up yet — add CF_AI_TOKEN (Cloudflare Workers AI) in Vercel." }); return; }

  const { audio } = await readBody(req);
  if (!audio) { res.status(400).json({ error: "No audio received." }); return; }
  const buf = Buffer.from(String(audio), "base64");
  if (!buf.length) { res.status(400).json({ error: "Empty recording." }); return; }
  if (buf.length > 8 * 1024 * 1024) { res.status(413).json({ error: "Recording is too long — keep it under a minute or two." }); return; }

  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/openai/whisper`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CF_AI_TOKEN}` },
      body: buf,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) {
      const msg = j.errors?.[0]?.message || `Transcription failed (${r.status}).`;
      res.status(r.status === 403 || r.status === 401 ? 503 : 502).json({ error: /auth|permission|token/i.test(msg) ? "The Cloudflare token can't use Workers AI — create a token with 'Workers AI: Read' and add it as CF_AI_TOKEN in Vercel." : msg });
      return;
    }
    res.status(200).json({ text: (j.result?.text || "").trim() });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
