// Send an SMS/MMS through Jivetel's texting platform. Inert until
// JIVETEL_API_TOKEN is set in Vercel. The "from" number resolves from the
// JIVETEL_NUMBERS env JSON ({"Elie":"+1732...","Moshe":"+1..."}) by the
// caller's name, else JIVETEL_FROM_DEFAULT — one token, everyone texts
// from their own line.
import { requireAppUser } from "../../lib/showings.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const user = await requireAppUser(req);
  if (!user) return res.status(401).json({ error: "Sign in first." });
  const token = process.env.JIVETEL_API_TOKEN;
  if (!token) return res.status(503).json({ error: "Jivetel isn't connected yet (JIVETEL_API_TOKEN missing)." });
  try {
    const { to, message, media, fromName } = req.body || {};
    if (!to || !message) return res.status(400).json({ error: "to and message are required." });
    let numbers = {};
    try { numbers = JSON.parse(process.env.JIVETEL_NUMBERS || "{}"); } catch { /* bad JSON → default only */ }
    // Forgiving lookup: "Elie" in JIVETEL_NUMBERS matches a login named
    // "Elie Hassan" (first name, case-insensitive), else email prefix.
    const first = (s) => String(s || "").trim().toLowerCase().split(/[\s@]+/)[0];
    const cands = [fromName, user.user_metadata?.name, user.email].filter(Boolean);
    let from = null;
    for (const c of cands) {
      const hit = numbers[c] || numbers[Object.keys(numbers).find((k) => first(k) && first(k) === first(c)) || ""];
      if (hit) { from = hit; break; }
    }
    from = from || process.env.JIVETEL_FROM_DEFAULT || Object.values(numbers)[0];
    if (!from) return res.status(503).json({ error: "No from-number configured (JIVETEL_NUMBERS / JIVETEL_FROM_DEFAULT)." });
    const e164 = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.length === 10 ? "+1" + d : d.length === 11 && d.startsWith("1") ? "+" + d : String(p || ""); };
    const body = { to: e164(to), from: e164(from), message: String(message) };
    if (Array.isArray(media) && media.length) body.media = media;
    const r = await fetch("https://jivetel-txt.jivetel.com/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token.includes(" ") ? token : `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) return res.status(502).json({ error: `Jivetel send failed (${r.status})`, detail: text.slice(0, 300) });
    let data = null; try { data = JSON.parse(text); } catch { /* non-JSON OK */ }
    return res.status(200).json({ ok: true, from: body.from, result: data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
